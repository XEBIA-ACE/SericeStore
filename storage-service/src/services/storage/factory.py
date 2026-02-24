"""
Storage backend factory.

Returns the appropriate :class:`BaseStorageBackend` implementation based on
the ``STORAGE_BACKEND`` environment variable.
"""

from src.core.config import Settings, StorageBackend
from src.services.storage.base import BaseStorageBackend


def create_storage_backend(settings: Settings) -> BaseStorageBackend:
    """
    Instantiate and return the configured storage backend.

    Args:
        settings: Application configuration.

    Returns:
        A concrete :class:`BaseStorageBackend` instance.

    Raises:
        ValueError: For an unknown backend name.
    """
    backend = settings.storage_backend

    if backend == StorageBackend.s3:
        from src.services.storage.s3_storage import S3StorageBackend
        return S3StorageBackend(settings)

    if backend == StorageBackend.gcs:
        from src.services.storage.gcs_storage import GCSStorageBackend
        return GCSStorageBackend(settings)

    if backend == StorageBackend.minio:
        from src.services.storage.minio_storage import MinIOStorageBackend
        return MinIOStorageBackend(settings)

    raise ValueError(f"Unknown storage backend: {backend!r}")
