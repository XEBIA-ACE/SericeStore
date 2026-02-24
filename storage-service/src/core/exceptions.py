"""
Domain exception hierarchy.

All application-specific errors inherit from StorageServiceError so that
FastAPI exception handlers can discriminate cleanly between expected and
unexpected failures.
"""

from typing import Any, Optional


class StorageServiceError(Exception):
    """Base error for all Storage Service failures."""

    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"

    def __init__(self, message: str, details: Optional[Any] = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details

    def to_dict(self) -> dict:
        payload: dict = {"error": self.error_code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload


# ── Storage ───────────────────────────────────────────────────────────────────

class StorageBackendError(StorageServiceError):
    """Raised when a storage backend (S3/GCS/MinIO) operation fails."""
    status_code = 502
    error_code = "STORAGE_BACKEND_ERROR"


class FileNotFoundError(StorageServiceError):
    """Raised when the requested object does not exist in the store."""
    status_code = 404
    error_code = "FILE_NOT_FOUND"


class FileTooLargeError(StorageServiceError):
    """Raised when the uploaded file exceeds the configured size limit."""
    status_code = 413
    error_code = "FILE_TOO_LARGE"


class UnsupportedMediaTypeError(StorageServiceError):
    """Raised when the file MIME type is not allowed."""
    status_code = 415
    error_code = "UNSUPPORTED_MEDIA_TYPE"


# ── Processing ────────────────────────────────────────────────────────────────

class ImageProcessingError(StorageServiceError):
    """Raised when ImageMagick processing fails."""
    status_code = 422
    error_code = "IMAGE_PROCESSING_ERROR"


class VideoProcessingError(StorageServiceError):
    """Raised when FFmpeg processing fails."""
    status_code = 422
    error_code = "VIDEO_PROCESSING_ERROR"


class MediaProbeError(StorageServiceError):
    """Raised when FFprobe cannot read media metadata."""
    status_code = 422
    error_code = "MEDIA_PROBE_ERROR"


# ── Validation ────────────────────────────────────────────────────────────────

class ValidationError(StorageServiceError):
    """Raised for invalid request parameters."""
    status_code = 400
    error_code = "VALIDATION_ERROR"


# ── Auth (placeholder) ────────────────────────────────────────────────────────

class AuthenticationError(StorageServiceError):
    """Raised when a request cannot be authenticated."""
    status_code = 401
    error_code = "AUTHENTICATION_ERROR"


class AuthorizationError(StorageServiceError):
    """Raised when a request is authenticated but not authorised."""
    status_code = 403
    error_code = "AUTHORIZATION_ERROR"
