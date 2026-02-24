from functools import lru_cache

from src.infrastructure.media.image_processor import ImageProcessor
from src.infrastructure.media.video_processor import VideoProcessor


@lru_cache()
def get_image_processor() -> ImageProcessor:
    return ImageProcessor()


@lru_cache()
def get_video_processor() -> VideoProcessor:
    return VideoProcessor()
