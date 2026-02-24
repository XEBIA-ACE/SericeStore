"""
Google Cloud Storage backend implementation.
Uses google-cloud-storage with asyncio thread-pool execution.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from functools import partial
from typing import AsyncIterator, Optional

from google.api_core.exceptions import Conflict, NotFound
from google.cloud import storage as gcs
from google.oauth2 import service_account

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

# GCS client is synchronous; run blocking calls in a thread pool.
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="gcs")


def _run_sync(func, *args, **kwargs):
    """Run a sync function in the shared executor and await it."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, partial(func, *args, **kwargs))


class GCSStorage(StorageRepository):
    """Google Cloud Storage adapter."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._bucket_name = self._settings.gcs_bucket

        if self._settings.gcs_credentials_file:
            credentials = service_account.Credentials.from_service_account_file(
                self._settings.gcs_credentials_file
            )
            self._client = gcs.Client(
                project=self._settings.gcs_project_id,
                credentials=credentials,
            )
        else:
            # Use Application Default Credentials
            self._client = gcs.Client(project=self._settings.gcs_project_id)

        self._bucket = self._client.bucket(self._bucket_name)

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

        def _do_upload():
            blob = self._bucket.blob(key)
            blob.content_type = content_type
            if metadata:
                blob.metadata = {k: str(v) for k, v in metadata.items()}
            blob.upload_from_string(data, content_type=content_type)
            return blob

        try:
            blob = await _run_sync(_do_upload)
            logger.info("gcs_upload_success", key=key, size=len(data))
            return StoredFile(
                key=key,
                bucket=self._bucket_name,
                backend="gcs",
                content_type=content_type,
                size_bytes=len(data),
                etag=blob.etag,
                metadata=metadata or {},
            )
        except Exception as exc:
            logger.error("gcs_upload_failed", key=key, error=str(exc))
            raise StorageError(f"GCS upload failed for key '{key}': {exc}") from exc

    async def upload_stream(
        self,
        key: str,
        stream: AsyncIterator[bytes],
        content_type: str,
        size_hint: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        # Collect the stream into memory for GCS (resumable uploads for large files
        # are complex; for production, consider google-resumable-media library).
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

        def _do_download():
            blob = self._bucket.blob(key)
            if not blob.exists():
                raise ObjectNotFoundError(f"Object not found: {key}")
            return blob.download_as_bytes()

        try:
            data = await _run_sync(_do_download)
            logger.info("gcs_download_success", key=key, size=len(data))
            return data
        except ObjectNotFoundError:
            raise
        except Exception as exc:
            raise StorageError(f"GCS download failed for key '{key}': {exc}") from exc

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        data = await self.download(key)
        chunk_size = 1024 * 1024
        for i in range(0, len(data), chunk_size):
            yield data[i : i + chunk_size]

    # ------------------------------------------------------------------
    # Delete / Exists / Metadata
    # ------------------------------------------------------------------

    async def delete(self, key: str) -> None:
        key = sanitize_key(key)

        def _do_delete():
            blob = self._bucket.blob(key)
            blob.delete()

        try:
            await _run_sync(_do_delete)
            logger.info("gcs_delete_success", key=key)
        except NotFound:
            raise ObjectNotFoundError(f"Object not found: {key}")
        except Exception as exc:
            raise StorageError(f"GCS delete failed for key '{key}': {exc}") from exc

    async def exists(self, key: str) -> bool:
        key = sanitize_key(key)
        try:
            result = await _run_sync(self._bucket.blob(key).exists)
            return result
        except Exception:
            return False

    async def get_metadata(self, key: str) -> StoredFile:
        key = sanitize_key(key)

        def _do_head():
            blob = self._bucket.blob(key)
            blob.reload()
            return blob

        try:
            blob = await _run_sync(_do_head)
            return StoredFile(
                key=key,
                bucket=self._bucket_name,
                backend="gcs",
                content_type=blob.content_type or "application/octet-stream",
                size_bytes=blob.size or 0,
                etag=blob.etag,
                metadata=blob.metadata or {},
            )
        except NotFound:
            raise ObjectNotFoundError(f"Object not found: {key}")
        except Exception as exc:
            raise StorageError(f"GCS metadata fetch failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StoredFile], Optional[str]]:
        def _do_list():
            blobs = self._client.list_blobs(
                self._bucket_name,
                prefix=prefix,
                max_results=min(max_keys, 1000),
                page_token=continuation_token,
            )
            page = next(blobs.pages)
            items = list(page)
            return items, blobs.next_page_token

        try:
            items, next_token = await _run_sync(_do_list)
            files = [
                StoredFile(
                    key=blob.name,
                    bucket=self._bucket_name,
                    backend="gcs",
                    content_type=blob.content_type or "application/octet-stream",
                    size_bytes=blob.size or 0,
                    etag=blob.etag,
                )
                for blob in items
            ]
            return files, next_token
        except Exception as exc:
            raise StorageError(f"GCS list failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Presigned URLs
    # ------------------------------------------------------------------

    async def generate_presigned_download_url(
        self, key: str, expires_in: int = 3600
    ) -> str:
        key = sanitize_key(key)

        def _do_sign():
            blob = self._bucket.blob(key)
            return blob.generate_signed_url(
                expiration=timedelta(seconds=expires_in),
                method="GET",
                version="v4",
            )

        try:
            url = await _run_sync(_do_sign)
            return url
        except Exception as exc:
            raise PresignedUrlError(f"GCS presigned download URL failed: {exc}") from exc

    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        max_size_bytes: Optional[int] = None,
    ) -> dict:
        key = sanitize_key(key)

        def _do_sign():
            blob = self._bucket.blob(key)
            url = blob.generate_signed_url(
                expiration=timedelta(seconds=expires_in),
                method="PUT",
                content_type=content_type,
                version="v4",
            )
            return {"url": url, "fields": {}, "method": "PUT", "content_type": content_type}

        try:
            return await _run_sync(_do_sign)
        except Exception as exc:
            raise PresignedUrlError(f"GCS presigned upload URL failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Bucket management
    # ------------------------------------------------------------------

    async def ensure_bucket_exists(self) -> None:
        def _do_ensure():
            try:
                self._client.create_bucket(self._bucket_name)
                logger.info("gcs_bucket_created", bucket=self._bucket_name)
            except Conflict:
                pass  # Already exists

        try:
            await _run_sync(_do_ensure)
        except Exception as exc:
            raise StorageBackendUnavailableError(f"GCS bucket creation failed: {exc}") from exc

    async def health_check(self) -> bool:
        try:
            await _run_sync(self._bucket.reload)
            return True
        except Exception:
            return False
