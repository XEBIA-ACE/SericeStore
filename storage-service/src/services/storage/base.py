"""
Abstract storage backend interface.

All concrete backends (S3, GCS, MinIO) implement this protocol so that
the rest of the application is decoupled from any specific cloud provider.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional


@dataclass
class ObjectMetadata:
    """Metadata returned after a successful upload or stat operation."""
    key: str
    bucket: str
    size: int
    content_type: str
    etag: str
    url: str
    extra: dict = field(default_factory=dict)


@dataclass
class PresignedUrlResult:
    """A pre-signed URL together with its expiry information."""
    url: str
    expires_in_seconds: int
    method: str  # "GET" | "PUT"


class BaseStorageBackend(ABC):
    """
    Abstract base for all storage backends.

    Every method is async so that concurrent uploads/downloads don't block
    the FastAPI event loop.
    """

    @abstractmethod
    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> ObjectMetadata:
        """
        Store *data* under *key*.

        Args:
            key:          Object path inside the bucket.
            data:         Raw bytes to persist.
            content_type: MIME type of the object.
            metadata:     Optional user-defined key/value tags.

        Returns:
            ObjectMetadata describing the stored object.
        """

    @abstractmethod
    async def download(self, key: str) -> bytes:
        """
        Retrieve the raw bytes of the object identified by *key*.

        Raises:
            FileNotFoundError: When the object does not exist.
        """

    @abstractmethod
    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        """
        Return an async iterator that streams the object in chunks.

        Prefer this over :meth:`download` for large files to avoid loading
        the entire payload into memory.
        """

    @abstractmethod
    async def delete(self, key: str) -> None:
        """
        Permanently remove the object identified by *key*.

        Raises:
            FileNotFoundError: When the object does not exist.
        """

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Return *True* if the object exists, *False* otherwise."""

    @abstractmethod
    async def stat(self, key: str) -> ObjectMetadata:
        """
        Return metadata for the object identified by *key*.

        Raises:
            FileNotFoundError: When the object does not exist.
        """

    @abstractmethod
    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
    ) -> list[ObjectMetadata]:
        """
        List objects whose keys start with *prefix*.

        Args:
            prefix:   Key prefix used to filter results.
            max_keys: Maximum number of results to return.

        Returns:
            A list of :class:`ObjectMetadata` instances.
        """

    @abstractmethod
    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        method: str = "GET",
    ) -> PresignedUrlResult:
        """
        Generate a temporary, signed URL for direct client access.

        Args:
            key:        The object key.
            expires_in: URL validity period in seconds.
            method:     HTTP method ("GET" for download, "PUT" for upload).

        Returns:
            A :class:`PresignedUrlResult`.
        """

    @abstractmethod
    async def ensure_bucket(self) -> None:
        """
        Create the target bucket if it does not already exist.

        Called once at application startup so the service is self-bootstrapping.
        """
