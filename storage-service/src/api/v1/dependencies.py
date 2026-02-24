"""
FastAPI dependency injection providers.

All route handlers receive their collaborators through these functions so
that the wiring is transparent, testable, and respects the service's singleton
lifecycle.
"""

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from src.core.config import Settings, get_settings
from src.services.image_service import ImageService
from src.services.storage import BaseStorageBackend, create_storage_backend
from src.services.video_service import VideoService


@lru_cache(maxsize=1)
def _storage_backend(settings: Settings) -> BaseStorageBackend:
    return create_storage_backend(settings)


@lru_cache(maxsize=1)
def _image_service(settings: Settings) -> ImageService:
    return ImageService(settings)


@lru_cache(maxsize=1)
def _video_service(settings: Settings) -> VideoService:
    return VideoService(settings)


# ── Annotated type aliases used in route signatures ───────────────────────────

def get_storage(
    settings: Annotated[Settings, Depends(get_settings)],
) -> BaseStorageBackend:
    return _storage_backend(settings)


def get_image_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> ImageService:
    return _image_service(settings)


def get_video_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> VideoService:
    return _video_service(settings)


StorageDep = Annotated[BaseStorageBackend, Depends(get_storage)]
ImageDep = Annotated[ImageService, Depends(get_image_service)]
VideoDep = Annotated[VideoService, Depends(get_video_service)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
