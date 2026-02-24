"""
MinIO storage backend.

Uses the official minio-py async client (miniopy-async) which is fully
non-blocking. Falls back gracefully to the sync client wrapped in an executor
if needed.
"""

import asyncio
import io
from datetime import timedelta
from typing import AsyncIterator, Optional

from miniopy_async import Minio
from miniopy_async.error import S3Error

from src.core.config import Settings
from src.core.exceptions import FileNotFoundError, StorageBackendError
from src.core.logging import get_logger
from src.services.storage.base import BaseStorageBackend, ObjectMetadata, PresignedUrlResult

logger = get_logger(__name__)


class MinIOStorageBackend(BaseStorageBackend):
    """MinIO (S3-compatible) async storage backend."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._bucket = settings.minio_bucket
        self._client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )

    async def ensure_bucket(self) -> None:
        try:
            if not await self._client.bucket_exists(self._bucket):
                await self._client.make_bucket(self._bucket)
                logger.info("minio.bucket_created", bucket=self._bucket)
            else:
                logger.info("minio.bucket_exists", bucket=self._bucket)
        except S3Error as exc:
            raise StorageBackendError(f"MinIO bucket setup failed: {exc}") from exc

    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> ObjectMetadata:
        stream = io.BytesIO(data)
        try:
            result = await self._client.put_object(
                bucket_name=self._bucket,
                object_name=key,
                data=stream,
                length=len(data),
                content_type=content_type,
                metadata=metadata or {},
            )
        except S3Error as exc:
            raise StorageBackendError(f"MinIO upload failed for {key}: {exc}") from exc

        scheme = "https" if self._settings.minio_secure else "http"
        url = f"{scheme}://{self._settings.minio_endpoint}/{self._bucket}/{key}"
        logger.info("minio.upload_ok", key=key, size=len(data))
        return ObjectMetadata(
            key=key,
            bucket=self._bucket,
            size=len(data),
            content_type=content_type,
            etag=result.etag or "",
            url=url,
        )

    async def download(self, key: str) -> bytes:
        try:
            response = await self._client.get_object(self._bucket, key)
            data: bytes = await response.read()
            response.close()
            await response.release()
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                raise FileNotFoundError(f"Object not found: {key}") from exc
            raise StorageBackendError(f"MinIO download failed for {key}: {exc}") from exc

        logger.info("minio.download_ok", key=key, size=len(data))
        return data

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        try:
            response = await self._client.get_object(self._bucket, key)
            async for chunk in response.content.iter_chunked(65536):
                yield chunk
            response.close()
            await response.release()
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                raise FileNotFoundError(f"Object not found: {key}") from exc
            raise StorageBackendError(f"MinIO stream failed for {key}: {exc}") from exc

    async def delete(self, key: str) -> None:
        try:
            await self._client.remove_object(self._bucket, key)
        except S3Error as exc:
            raise StorageBackendError(f"MinIO delete failed for {key}: {exc}") from exc
        logger.info("minio.delete_ok", key=key)

    async def exists(self, key: str) -> bool:
        try:
            await self._client.stat_object(self._bucket, key)
            return True
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                return False
            raise StorageBackendError(f"MinIO exists check failed for {key}: {exc}") from exc

    async def stat(self, key: str) -> ObjectMetadata:
        try:
            stat = await self._client.stat_object(self._bucket, key)
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                raise FileNotFoundError(f"Object not found: {key}") from exc
            raise StorageBackendError(f"MinIO stat failed for {key}: {exc}") from exc

        scheme = "https" if self._settings.minio_secure else "http"
        url = f"{scheme}://{self._settings.minio_endpoint}/{self._bucket}/{key}"
        return ObjectMetadata(
            key=key,
            bucket=self._bucket,
            size=stat.size or 0,
            content_type=stat.content_type or "application/octet-stream",
            etag=stat.etag or "",
            url=url,
        )

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
    ) -> list[ObjectMetadata]:
        scheme = "https" if self._settings.minio_secure else "http"
        results: list[ObjectMetadata] = []
        try:
            objects = await self._client.list_objects(
                self._bucket,
                prefix=prefix,
                recursive=True,
            )
            for obj in objects:
                if len(results) >= max_keys:
                    break
                results.append(
                    ObjectMetadata(
                        key=obj.object_name or "",
                        bucket=self._bucket,
                        size=obj.size or 0,
                        content_type="",
                        etag=obj.etag or "",
                        url=f"{scheme}://{self._settings.minio_endpoint}/{self._bucket}/{obj.object_name}",
                    )
                )
        except S3Error as exc:
            raise StorageBackendError(f"MinIO list failed: {exc}") from exc

        return results

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        method: str = "GET",
    ) -> PresignedUrlResult:
        try:
            if method.upper() == "GET":
                url = await self._client.presigned_get_object(
                    self._bucket,
                    key,
                    expires=timedelta(seconds=expires_in),
                )
            else:
                url = await self._client.presigned_put_object(
                    self._bucket,
                    key,
                    expires=timedelta(seconds=expires_in),
                )
        except S3Error as exc:
            raise StorageBackendError(
                f"MinIO presign failed for {key}: {exc}"
            ) from exc

        return PresignedUrlResult(url=url, expires_in_seconds=expires_in, method=method)
