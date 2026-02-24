"""
Abstract repository interface for storage backends.
All concrete implementations (S3, GCS, MinIO) must satisfy this contract.
"""
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

from src.domain.models.file import StoredFile


class StorageRepository(ABC):
    """Port (interface) for the storage infrastructure adapter."""

    # ------------------------------------------------------------------
    # Object operations
    # ------------------------------------------------------------------

    @abstractmethod
    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        """
        Upload raw bytes to the storage backend.

        Args:
            key: Destination path within the bucket.
            data: Raw file bytes.
            content_type: MIME type of the object.
            metadata: Optional key-value pairs stored alongside the object.

        Returns:
            StoredFile domain object describing the created object.
        """

    @abstractmethod
    async def upload_stream(
        self,
        key: str,
        stream: AsyncIterator[bytes],
        content_type: str,
        size_hint: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        """
        Upload from an async byte stream (multipart upload for large files).
        """

    @abstractmethod
    async def download(self, key: str) -> bytes:
        """Download and return the full object content."""

    @abstractmethod
    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        """Stream object content in chunks."""

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Permanently delete an object."""

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Return True if the object exists."""

    @abstractmethod
    async def get_metadata(self, key: str) -> StoredFile:
        """Fetch metadata for an existing object without downloading content."""

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    @abstractmethod
    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StoredFile], Optional[str]]:
        """
        List objects matching a prefix.

        Returns:
            Tuple of (list of StoredFile, next_continuation_token or None).
        """

    # ------------------------------------------------------------------
    # Presigned URLs
    # ------------------------------------------------------------------

    @abstractmethod
    async def generate_presigned_download_url(
        self, key: str, expires_in: int = 3600
    ) -> str:
        """Generate a time-limited URL for direct client downloads."""

    @abstractmethod
    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        max_size_bytes: Optional[int] = None,
    ) -> dict:
        """
        Generate a presigned POST / PUT for direct client uploads.

        Returns:
            Dict with at least ``url`` and ``fields`` keys.
        """

    # ------------------------------------------------------------------
    # Bucket management
    # ------------------------------------------------------------------

    @abstractmethod
    async def ensure_bucket_exists(self) -> None:
        """Create the bucket if it does not already exist."""

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the backend is reachable and the bucket is accessible."""
