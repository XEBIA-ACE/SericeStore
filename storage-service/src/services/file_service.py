"""
File service — business logic for uploading, downloading, listing,
deleting, and generating presigned URLs for stored files.
"""
import os
import uuid
from typing import AsyncIterator, Optional

from src.core.config import get_settings
from src.core.exceptions import (
    FileTooLargeError,
    ObjectNotFoundError,
    UnsupportedMediaTypeError,
    ValidationError,
)
from src.core.logging import get_logger
from src.domain.models.file import StoredFile
from src.domain.repositories.storage_repository import StorageRepository
from src.infrastructure.storage.base import guess_content_type, sanitize_key

logger = get_logger(__name__)


class FileService:
    """
    Application service for file management.

    Depends on a StorageRepository (injected) and applies validation,
    key generation, and business rules before delegating to the backend.
    """

    def __init__(self, storage: StorageRepository) -> None:
        self._storage = storage
        self._settings = get_settings()

    # ------------------------------------------------------------------
    # Key generation
    # ------------------------------------------------------------------

    def build_key(
        self,
        filename: str,
        prefix: str = "",
        use_uuid: bool = True,
    ) -> str:
        """
        Construct a storage key for the given filename.

        By default a UUID4 subdirectory is prepended to prevent key collisions
        and enable sharding strategies in object stores.

        Example: "images/3f7a9d.../photo.jpg"
        """
        safe_name = sanitize_key(filename)
        parts = []
        if prefix:
            parts.append(prefix.strip("/"))
        if use_uuid:
            parts.append(str(uuid.uuid4()))
        parts.append(safe_name)
        return "/".join(parts)

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_upload(
        self,
        data: bytes,
        content_type: str,
        allowed_types: Optional[list[str]] = None,
    ) -> None:
        """Raise if the upload violates size or content-type restrictions."""
        if len(data) > self._settings.max_upload_size_bytes:
            raise FileTooLargeError(len(data), self._settings.max_upload_size_bytes)

        if allowed_types and content_type not in allowed_types:
            raise UnsupportedMediaTypeError(content_type)

    def _all_allowed_types(self) -> list[str]:
        return (
            self._settings.allowed_image_types
            + self._settings.allowed_video_types
            + self._settings.allowed_audio_types
            + ["application/octet-stream", "text/plain", "application/pdf"]
        )

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    async def upload_file(
        self,
        filename: str,
        data: bytes,
        content_type: Optional[str] = None,
        prefix: str = "",
        metadata: Optional[dict] = None,
        allowed_types: Optional[list[str]] = None,
    ) -> StoredFile:
        """
        Upload a file to the configured storage backend.

        Args:
            filename: Original filename (used for extension and key generation).
            data: Raw file bytes.
            content_type: MIME type; guessed from filename if not provided.
            prefix: Optional path prefix within the bucket.
            metadata: Extra key-value pairs to store alongside the object.
            allowed_types: Whitelist of MIME types; None means all are accepted.

        Returns:
            StoredFile representing the created object.
        """
        resolved_ct = content_type or guess_content_type(filename)
        effective_allowed = allowed_types  # None = permissive
        self._validate_upload(data, resolved_ct, effective_allowed)

        key = self.build_key(filename, prefix=prefix)
        stored = await self._storage.upload(
            key=key,
            data=data,
            content_type=resolved_ct,
            metadata={**(metadata or {}), "original_filename": filename},
        )
        stored.original_filename = filename
        logger.info(
            "file_uploaded",
            key=key,
            size=len(data),
            content_type=resolved_ct,
        )
        return stored

    async def upload_stream(
        self,
        filename: str,
        stream: AsyncIterator[bytes],
        content_type: Optional[str] = None,
        prefix: str = "",
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        """Upload a file from an async byte stream (for large files)."""
        resolved_ct = content_type or guess_content_type(filename)
        key = self.build_key(filename, prefix=prefix)
        stored = await self._storage.upload_stream(
            key=key,
            stream=stream,
            content_type=resolved_ct,
            metadata={**(metadata or {}), "original_filename": filename},
        )
        stored.original_filename = filename
        logger.info("file_stream_uploaded", key=key)
        return stored

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    async def download_file(self, key: str) -> bytes:
        """Download and return full file content."""
        if not await self._storage.exists(key):
            raise ObjectNotFoundError(f"Object not found: {key}")
        return await self._storage.download(key)

    async def stream_file(self, key: str) -> AsyncIterator[bytes]:
        """Stream file content in chunks."""
        if not await self._storage.exists(key):
            raise ObjectNotFoundError(f"Object not found: {key}")
        async for chunk in self._storage.download_stream(key):
            yield chunk

    # ------------------------------------------------------------------
    # Metadata / listing
    # ------------------------------------------------------------------

    async def get_file_info(self, key: str) -> StoredFile:
        """Return metadata for a stored file without downloading content."""
        return await self._storage.get_metadata(key)

    async def list_files(
        self,
        prefix: str = "",
        max_keys: int = 100,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StoredFile], Optional[str]]:
        """List files with optional prefix filtering and pagination."""
        if max_keys < 1 or max_keys > 1000:
            raise ValidationError("max_keys must be between 1 and 1000")
        return await self._storage.list_objects(
            prefix=prefix,
            max_keys=max_keys,
            continuation_token=continuation_token,
        )

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_file(self, key: str) -> None:
        """Delete a stored file. Raises ObjectNotFoundError if absent."""
        if not await self._storage.exists(key):
            raise ObjectNotFoundError(f"Object not found: {key}")
        await self._storage.delete(key)
        logger.info("file_deleted", key=key)

    # ------------------------------------------------------------------
    # Presigned URLs
    # ------------------------------------------------------------------

    async def get_download_url(
        self, key: str, expires_in: Optional[int] = None
    ) -> str:
        """Generate a presigned URL for client-side file download."""
        if not await self._storage.exists(key):
            raise ObjectNotFoundError(f"Object not found: {key}")
        ttl = expires_in or self._settings.presigned_url_expiry
        return await self._storage.generate_presigned_download_url(key, ttl)

    async def get_upload_url(
        self,
        filename: str,
        content_type: str,
        prefix: str = "",
        expires_in: Optional[int] = None,
    ) -> dict:
        """
        Generate a presigned URL that allows the client to upload directly to storage.

        Returns a dict with ``url``, ``fields``, and the ``key`` that will be used.
        """
        key = self.build_key(filename, prefix=prefix, use_uuid=True)
        ttl = expires_in or self._settings.presigned_url_expiry
        result = await self._storage.generate_presigned_upload_url(
            key=key,
            content_type=content_type,
            expires_in=ttl,
            max_size_bytes=self._settings.max_upload_size_bytes,
        )
        return {**result, "key": key}

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        return await self._storage.health_check()
