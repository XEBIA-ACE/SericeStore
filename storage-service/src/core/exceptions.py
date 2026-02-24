"""
Domain and application exceptions.
All custom exceptions derive from SericeStoreError so callers can catch broadly.
"""
from typing import Optional


class SericeStoreError(Exception):
    """Base exception for all SericeStore errors."""

    def __init__(self, message: str, details: Optional[dict] = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


# ---------------------------------------------------------------------------
# Storage errors
# ---------------------------------------------------------------------------

class StorageError(SericeStoreError):
    """Generic storage backend error."""


class ObjectNotFoundError(StorageError):
    """Requested object does not exist in the storage backend."""


class ObjectAlreadyExistsError(StorageError):
    """Object with the given key already exists."""


class StorageBackendUnavailableError(StorageError):
    """Storage backend is unreachable or misconfigured."""


class BucketNotFoundError(StorageError):
    """Bucket / container does not exist."""


class PresignedUrlError(StorageError):
    """Failed to generate a presigned URL."""


# ---------------------------------------------------------------------------
# Media processing errors
# ---------------------------------------------------------------------------

class MediaProcessingError(SericeStoreError):
    """Generic media processing error."""


class UnsupportedMediaTypeError(MediaProcessingError):
    """The uploaded file's MIME type is not supported."""

    def __init__(self, mime_type: str) -> None:
        super().__init__(
            f"Unsupported media type: {mime_type}",
            {"mime_type": mime_type},
        )


class ImageProcessingError(MediaProcessingError):
    """ImageMagick operation failed."""


class VideoProcessingError(MediaProcessingError):
    """FFmpeg operation failed."""


class FileTooLargeError(SericeStoreError):
    """Uploaded file exceeds the configured size limit."""

    def __init__(self, size_bytes: int, limit_bytes: int) -> None:
        super().__init__(
            f"File size {size_bytes} bytes exceeds limit of {limit_bytes} bytes",
            {"size_bytes": size_bytes, "limit_bytes": limit_bytes},
        )


# ---------------------------------------------------------------------------
# Validation errors
# ---------------------------------------------------------------------------

class ValidationError(SericeStoreError):
    """Request validation failed."""


class InvalidKeyError(ValidationError):
    """Object key contains forbidden characters or patterns."""
