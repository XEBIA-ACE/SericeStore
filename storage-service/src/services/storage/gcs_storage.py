"""
Google Cloud Storage backend.

Uses google-cloud-storage with asyncio via run_in_executor so that blocking
GCS SDK calls don't starve the FastAPI event loop.
"""

import asyncio
import functools
from datetime import timedelta
from typing import AsyncIterator, Optional

from google.cloud import storage as gcs
from google.oauth2 import service_account

from src.core.config import Settings
from src.core.exceptions import FileNotFoundError, StorageBackendError
from src.core.logging import get_logger
from src.services.storage.base import BaseStorageBackend, ObjectMetadata, PresignedUrlResult

logger = get_logger(__name__)


def _run_sync(func, *args, **kwargs):
    """Run a synchronous callable in the default thread-pool executor."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, functools.partial(func, *args, **kwargs))


class GCSStorageBackend(BaseStorageBackend):
    """Google Cloud Storage backend."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._bucket_name = settings.gcs_bucket

        if settings.gcs_credentials_json:
            credentials = service_account.Credentials.from_service_account_file(
                settings.gcs_credentials_json,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            self._client = gcs.Client(
                project=settings.gcs_project_id,
                credentials=credentials,
            )
        else:
            # Fallback to Application Default Credentials (ADC)
            self._client = gcs.Client(project=settings.gcs_project_id)

    def _bucket(self) -> gcs.Bucket:
        return self._client.bucket(self._bucket_name)

    async def ensure_bucket(self) -> None:
        def _check_or_create():
            bucket = self._client.lookup_bucket(self._bucket_name)
            if bucket is None:
                bucket = self._client.create_bucket(self._bucket_name)
                logger.info("gcs.bucket_created", bucket=self._bucket_name)
            else:
                logger.info("gcs.bucket_exists", bucket=self._bucket_name)

        try:
            await _run_sync(_check_or_create)
        except Exception as exc:
            raise StorageBackendError(f"GCS bucket setup failed: {exc}") from exc

    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> ObjectMetadata:
        def _upload():
            blob = self._bucket().blob(key)
            if metadata:
                blob.metadata = {k: str(v) for k, v in metadata.items()}
            blob.upload_from_string(data, content_type=content_type)
            blob.reload()
            return blob

        try:
            blob = await _run_sync(_upload)
        except Exception as exc:
            raise StorageBackendError(f"GCS upload failed for {key}: {exc}") from exc

        url = f"https://storage.googleapis.com/{self._bucket_name}/{key}"
        logger.info("gcs.upload_ok", key=key, size=len(data))
        return ObjectMetadata(
            key=key,
            bucket=self._bucket_name,
            size=len(data),
            content_type=content_type,
            etag=blob.etag or "",
            url=url,
        )

    async def download(self, key: str) -> bytes:
        def _download():
            blob = self._bucket().blob(key)
            if not blob.exists():
                raise FileNotFoundError(f"Object not found: {key}")
            return blob.download_as_bytes()

        try:
            data: bytes = await _run_sync(_download)
        except FileNotFoundError:
            raise
        except Exception as exc:
            raise StorageBackendError(f"GCS download failed for {key}: {exc}") from exc

        logger.info("gcs.download_ok", key=key, size=len(data))
        return data

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        # GCS SDK is synchronous; stream by yielding the full payload in one shot.
        # For large-file support, replace with a streaming HTTP request.
        data = await self.download(key)
        chunk_size = 65536
        for i in range(0, len(data), chunk_size):
            yield data[i : i + chunk_size]

    async def delete(self, key: str) -> None:
        def _delete():
            blob = self._bucket().blob(key)
            if not blob.exists():
                raise FileNotFoundError(f"Object not found: {key}")
            blob.delete()

        try:
            await _run_sync(_delete)
        except FileNotFoundError:
            raise
        except Exception as exc:
            raise StorageBackendError(f"GCS delete failed for {key}: {exc}") from exc

        logger.info("gcs.delete_ok", key=key)

    async def exists(self, key: str) -> bool:
        def _exists():
            return self._bucket().blob(key).exists()

        try:
            return await _run_sync(_exists)
        except Exception as exc:
            raise StorageBackendError(f"GCS exists check failed for {key}: {exc}") from exc

    async def stat(self, key: str) -> ObjectMetadata:
        def _stat():
            blob = self._bucket().blob(key)
            blob.reload()
            return blob

        try:
            blob = await _run_sync(_stat)
        except Exception as exc:
            raise StorageBackendError(f"GCS stat failed for {key}: {exc}") from exc

        if not blob.exists():
            raise FileNotFoundError(f"Object not found: {key}")

        return ObjectMetadata(
            key=key,
            bucket=self._bucket_name,
            size=blob.size or 0,
            content_type=blob.content_type or "application/octet-stream",
            etag=blob.etag or "",
            url=f"https://storage.googleapis.com/{self._bucket_name}/{key}",
        )

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
    ) -> list[ObjectMetadata]:
        def _list():
            return list(
                self._client.list_blobs(
                    self._bucket_name,
                    prefix=prefix,
                    max_results=max_keys,
                )
            )

        try:
            blobs = await _run_sync(_list)
        except Exception as exc:
            raise StorageBackendError(f"GCS list failed: {exc}") from exc

        return [
            ObjectMetadata(
                key=b.name,
                bucket=self._bucket_name,
                size=b.size or 0,
                content_type=b.content_type or "",
                etag=b.etag or "",
                url=f"https://storage.googleapis.com/{self._bucket_name}/{b.name}",
            )
            for b in blobs
        ]

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        method: str = "GET",
    ) -> PresignedUrlResult:
        def _sign():
            blob = self._bucket().blob(key)
            return blob.generate_signed_url(
                expiration=timedelta(seconds=expires_in),
                method=method.upper(),
                version="v4",
            )

        try:
            url: str = await _run_sync(_sign)
        except Exception as exc:
            raise StorageBackendError(
                f"GCS presign failed for {key}: {exc}"
            ) from exc

        return PresignedUrlResult(url=url, expires_in_seconds=expires_in, method=method)
