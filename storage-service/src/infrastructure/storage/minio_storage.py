"""
MinIO storage backend implementation.
Uses the async miniopy-async client.
"""
import io
from datetime import timedelta
from typing import AsyncIterator, Optional

from miniopy_async import Minio
from miniopy_async.commonconfig import ENABLED, Filter, LifecycleRule
from miniopy_async.deleteobjects import DeleteObject
from miniopy_async.error import S3Error

from src.core.config import get_settings
from src.core.exceptions import (
    ObjectNotFoundError,
    PresignedUrlError,
    StorageBackendUnavailableError,
    StorageError,
)
from src.core.logging import get_logger
from src.domain.models.file import StoredFile
from src.domain.repositories.storage_repository import StorageRepository
from src.infrastructure.storage.base import sanitize_key

logger = get_logger(__name__)


class MinIOStorage(StorageRepository):
    """MinIO storage adapter using miniopy-async."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._bucket = self._settings.minio_bucket
        self._client = Minio(
            endpoint=self._settings.minio_endpoint,
            access_key=self._settings.minio_access_key,
            secret_key=self._settings.minio_secret_key,
            secure=self._settings.minio_secure,
        )

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        key = sanitize_key(key)
        stream = io.BytesIO(data)

        try:
            result = await self._client.put_object(
                bucket_name=self._bucket,
                object_name=key,
                data=stream,
                length=len(data),
                content_type=content_type,
                metadata={k: str(v) for k, v in (metadata or {}).items()},
            )
            logger.info("minio_upload_success", key=key, size=len(data), etag=result.etag)
            return StoredFile(
                key=key,
                bucket=self._bucket,
                backend="minio",
                content_type=content_type,
                size_bytes=len(data),
                etag=result.etag,
                metadata=metadata or {},
            )
        except S3Error as exc:
            logger.error("minio_upload_failed", key=key, error=str(exc))
            raise StorageError(f"MinIO upload failed for key '{key}': {exc}") from exc

    async def upload_stream(
        self,
        key: str,
        stream: AsyncIterator[bytes],
        content_type: str,
        size_hint: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        key = sanitize_key(key)
        chunks = []
        total = 0
        async for chunk in stream:
            chunks.append(chunk)
            total += len(chunk)
        data = b"".join(chunks)

        return await self.upload(key, data, content_type, metadata)

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    async def download(self, key: str) -> bytes:
        key = sanitize_key(key)
        try:
            response = await self._client.get_object(
                bucket_name=self._bucket, object_name=key
            )
            data = await response.read()
            response.close()
            await response.release()
            logger.info("minio_download_success", key=key, size=len(data))
            return data
        except S3Error as exc:
            if exc.code == "NoSuchKey":
                raise ObjectNotFoundError(f"Object not found: {key}") from exc
            raise StorageError(f"MinIO download failed for key '{key}': {exc}") from exc

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        key = sanitize_key(key)
        try:
            response = await self._client.get_object(
                bucket_name=self._bucket, object_name=key
            )
            async for chunk in response.content.iter_chunked(1024 * 1024):
                yield chunk
            response.close()
            await response.release()
        except S3Error as exc:
            if exc.code == "NoSuchKey":
                raise ObjectNotFoundError(f"Object not found: {key}") from exc
            raise StorageError(f"MinIO stream failed for key '{key}': {exc}") from exc

    # ------------------------------------------------------------------
    # Delete / Exists / Metadata
    # ------------------------------------------------------------------

    async def delete(self, key: str) -> None:
        key = sanitize_key(key)
        try:
            await self._client.remove_object(
                bucket_name=self._bucket, object_name=key
            )
            logger.info("minio_delete_success", key=key)
        except S3Error as exc:
            raise StorageError(f"MinIO delete failed for key '{key}': {exc}") from exc

    async def exists(self, key: str) -> bool:
        key = sanitize_key(key)
        try:
            await self._client.stat_object(
                bucket_name=self._bucket, object_name=key
            )
            return True
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                return False
            return False

    async def get_metadata(self, key: str) -> StoredFile:
        key = sanitize_key(key)
        try:
            stat = await self._client.stat_object(
                bucket_name=self._bucket, object_name=key
            )
            return StoredFile(
                key=key,
                bucket=self._bucket,
                backend="minio",
                content_type=stat.content_type or "application/octet-stream",
                size_bytes=stat.size or 0,
                etag=stat.etag,
                metadata=stat.metadata or {},
            )
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                raise ObjectNotFoundError(f"Object not found: {key}") from exc
            raise StorageError(f"MinIO metadata failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StoredFile], Optional[str]]:
        try:
            objects = await self._client.list_objects(
                bucket_name=self._bucket,
                prefix=prefix,
                recursive=True,
            )
            files = []
            count = 0
            async for obj in objects:
                if count >= max_keys:
                    break
                files.append(
                    StoredFile(
                        key=obj.object_name,
                        bucket=self._bucket,
                        backend="minio",
                        content_type="application/octet-stream",
                        size_bytes=obj.size or 0,
                        etag=obj.etag,
                    )
                )
                count += 1
            return files, None  # MinIO pagination via continuation not directly exposed
        except S3Error as exc:
            raise StorageError(f"MinIO list failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Presigned URLs
    # ------------------------------------------------------------------

    async def generate_presigned_download_url(
        self, key: str, expires_in: int = 3600
    ) -> str:
        key = sanitize_key(key)
        try:
            url = await self._client.presigned_get_object(
                bucket_name=self._bucket,
                object_name=key,
                expires=timedelta(seconds=expires_in),
            )
            return url
        except S3Error as exc:
            raise PresignedUrlError(f"MinIO presigned download URL failed: {exc}") from exc

    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        max_size_bytes: Optional[int] = None,
    ) -> dict:
        key = sanitize_key(key)
        try:
            url = await self._client.presigned_put_object(
                bucket_name=self._bucket,
                object_name=key,
                expires=timedelta(seconds=expires_in),
            )
            return {"url": url, "fields": {}, "method": "PUT", "content_type": content_type}
        except S3Error as exc:
            raise PresignedUrlError(f"MinIO presigned upload URL failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Bucket management
    # ------------------------------------------------------------------

    async def ensure_bucket_exists(self) -> None:
        try:
            exists = await self._client.bucket_exists(self._bucket)
            if not exists:
                await self._client.make_bucket(self._bucket)
                logger.info("minio_bucket_created", bucket=self._bucket)
        except S3Error as exc:
            raise StorageBackendUnavailableError(
                f"MinIO bucket creation failed: {exc}"
            ) from exc

    async def health_check(self) -> bool:
        try:
            await self._client.bucket_exists(self._bucket)
            return True
        except Exception:
            return False
