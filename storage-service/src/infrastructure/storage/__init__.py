"""
Storage backend factory.
Returns the configured storage adapter based on settings.
"""
from functools import lru_cache

from src.core.config import StorageBackend, get_settings
from src.domain.repositories.storage_repository import StorageRepository


@lru_cache()
def get_storage_backend() -> StorageRepository:
    """
    Factory that returns the appropriate storage backend singleton.
    Called once on startup; result is cached for the process lifetime.
    """
    settings = get_settings()

    if settings.storage_backend == StorageBackend.S3:
        from src.infrastructure.storage.s3_storage import S3Storage
        return S3Storage()

    if settings.storage_backend == StorageBackend.GCS:
        from src.infrastructure.storage.gcs_storage import GCSStorage
        return GCSStorage()

    if settings.storage_backend == StorageBackend.MINIO:
        from src.infrastructure.storage.minio_storage import MinIOStorage
        return MinIOStorage()

    raise ValueError(f"Unsupported storage backend: {settings.storage_backend}")
