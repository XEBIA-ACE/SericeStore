"""
Media service — business logic for image and video processing operations.
Orchestrates ImageProcessor + VideoProcessor + FileService.
"""
from typing import Optional

from src.core.config import get_settings
from src.core.exceptions import (
    ObjectNotFoundError,
    UnsupportedMediaTypeError,
)
from src.core.logging import get_logger
from src.domain.models.media import (
    ImageFormat,
    ImageMetadata,
    ProcessingJob,
    ProcessingStatus,
    VideoFormat,
    VideoMetadata,
)
from src.infrastructure.media.image_processor import ImageProcessor
from src.infrastructure.media.video_processor import VideoProcessor
from src.services.file_service import FileService

logger = get_logger(__name__)


class MediaService:
    """
    Application service for media processing.

    Coordinates downloading from storage, applying transformations,
    and re-uploading results.
    """

    def __init__(
        self,
        file_service: FileService,
        image_processor: ImageProcessor,
        video_processor: VideoProcessor,
    ) -> None:
        self._files = file_service
        self._images = image_processor
        self._videos = video_processor
        self._settings = get_settings()

    # ------------------------------------------------------------------
    # Image operations
    # ------------------------------------------------------------------

    async def resize_image(
        self,
        source_key: str,
        width: int,
        height: int,
        maintain_aspect: bool = True,
        output_format: Optional[ImageFormat] = None,
        quality: Optional[int] = None,
        result_prefix: str = "processed/images",
    ) -> str:
        """
        Download an image, resize it, and upload the result.

        Returns:
            Key of the newly created resized image.
        """
        data = await self._files.download_file(source_key)
        info = await self._files.get_file_info(source_key)

        if not info.is_image:
            raise UnsupportedMediaTypeError(info.content_type)

        result = await self._images.resize(
            data=data,
            width=width,
            height=height,
            maintain_aspect=maintain_aspect,
            output_format=output_format,
            quality=quality,
        )

        ext = f".{output_format.value}" if output_format else info.extension
        result_filename = f"resize_{width}x{height}{ext}"
        stored = await self._files.upload_file(
            filename=result_filename,
            data=result,
            content_type=f"image/{output_format.value if output_format else info.extension.lstrip('.')}",
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "resize"},
        )
        logger.info("image_resize_stored", source=source_key, result=stored.key)
        return stored.key

    async def create_thumbnail(
        self,
        source_key: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
        result_prefix: str = "processed/thumbnails",
    ) -> str:
        """Create and store a thumbnail of the given image."""
        data = await self._files.download_file(source_key)
        info = await self._files.get_file_info(source_key)

        if not info.is_image:
            raise UnsupportedMediaTypeError(info.content_type)

        thumb = await self._images.thumbnail(data, width=width, height=height)

        w = width or self._settings.thumbnail_width
        h = height or self._settings.thumbnail_height
        result_filename = f"thumb_{w}x{h}{info.extension}"
        stored = await self._files.upload_file(
            filename=result_filename,
            data=thumb,
            content_type=info.content_type,
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "thumbnail"},
        )
        logger.info("thumbnail_stored", source=source_key, result=stored.key)
        return stored.key

    async def convert_image(
        self,
        source_key: str,
        output_format: ImageFormat,
        quality: Optional[int] = None,
        result_prefix: str = "processed/images",
    ) -> str:
        """Convert an image to a different format and store the result."""
        data = await self._files.download_file(source_key)
        info = await self._files.get_file_info(source_key)

        if not info.is_image:
            raise UnsupportedMediaTypeError(info.content_type)

        converted = await self._images.convert(data, output_format, quality)
        result_filename = f"converted.{output_format.value}"
        stored = await self._files.upload_file(
            filename=result_filename,
            data=converted,
            content_type=f"image/{output_format.value}",
            prefix=result_prefix,
            metadata={
                "source_key": source_key,
                "operation": "convert",
                "output_format": output_format.value,
            },
        )
        logger.info("image_convert_stored", source=source_key, result=stored.key)
        return stored.key

    async def crop_image(
        self,
        source_key: str,
        left: int,
        top: int,
        width: int,
        height: int,
        result_prefix: str = "processed/images",
    ) -> str:
        """Crop an image and store the result."""
        data = await self._files.download_file(source_key)
        info = await self._files.get_file_info(source_key)

        if not info.is_image:
            raise UnsupportedMediaTypeError(info.content_type)

        cropped = await self._images.crop(data, left, top, width, height)
        result_filename = f"crop_{left}_{top}_{width}x{height}{info.extension}"
        stored = await self._files.upload_file(
            filename=result_filename,
            data=cropped,
            content_type=info.content_type,
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "crop"},
        )
        return stored.key

    async def add_watermark(
        self,
        source_key: str,
        watermark_key: str,
        gravity: str = "south_east",
        opacity: float = 0.5,
        result_prefix: str = "processed/images",
    ) -> str:
        """Overlay a watermark from storage onto an image."""
        data = await self._files.download_file(source_key)
        wm_data = await self._files.download_file(watermark_key)
        info = await self._files.get_file_info(source_key)

        if not info.is_image:
            raise UnsupportedMediaTypeError(info.content_type)

        result = await self._images.watermark(data, wm_data, gravity=gravity, opacity=opacity)
        stored = await self._files.upload_file(
            filename=f"watermarked{info.extension}",
            data=result,
            content_type=info.content_type,
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "watermark"},
        )
        return stored.key

    async def get_image_metadata(self, source_key: str) -> ImageMetadata:
        """Return ImageMagick-extracted metadata for a stored image."""
        data = await self._files.download_file(source_key)
        return await self._images.get_metadata(data)

    # ------------------------------------------------------------------
    # Video operations
    # ------------------------------------------------------------------

    async def transcode_video(
        self,
        source_key: str,
        output_format: VideoFormat = VideoFormat.MP4,
        video_codec: str = "libx264",
        audio_codec: str = "aac",
        crf: Optional[int] = None,
        preset: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        result_prefix: str = "processed/videos",
    ) -> str:
        """Transcode a video to the specified codec/format and store the result."""
        info = await self._files.get_file_info(source_key)
        if not info.is_video:
            raise UnsupportedMediaTypeError(info.content_type)

        data = await self._files.download_file(source_key)
        transcoded = await self._videos.transcode(
            data=data,
            output_format=output_format.value,
            video_codec=video_codec,
            audio_codec=audio_codec,
            crf=crf,
            preset=preset,
            width=width,
            height=height,
            input_ext=info.extension,
        )
        result_filename = f"transcoded.{output_format.value}"
        stored = await self._files.upload_file(
            filename=result_filename,
            data=transcoded,
            content_type=f"video/{output_format.value}",
            prefix=result_prefix,
            metadata={
                "source_key": source_key,
                "operation": "transcode",
                "output_format": output_format.value,
            },
        )
        logger.info("video_transcode_stored", source=source_key, result=stored.key)
        return stored.key

    async def extract_video_frame(
        self,
        source_key: str,
        timestamp_seconds: float = 1.0,
        width: Optional[int] = None,
        height: Optional[int] = None,
        result_prefix: str = "processed/thumbnails",
    ) -> str:
        """Extract a video frame and store it as a JPEG."""
        info = await self._files.get_file_info(source_key)
        if not info.is_video:
            raise UnsupportedMediaTypeError(info.content_type)

        data = await self._files.download_file(source_key)
        frame = await self._videos.extract_frame(
            data=data,
            timestamp_seconds=timestamp_seconds,
            width=width,
            height=height,
            input_ext=info.extension,
        )
        stored = await self._files.upload_file(
            filename=f"frame_{timestamp_seconds}s.jpg",
            data=frame,
            content_type="image/jpeg",
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "frame_extract"},
        )
        return stored.key

    async def extract_audio_track(
        self,
        source_key: str,
        output_format: str = "mp3",
        bitrate: Optional[str] = None,
        result_prefix: str = "processed/audio",
    ) -> str:
        """Extract the audio track from a video and store it."""
        info = await self._files.get_file_info(source_key)
        if not info.is_video:
            raise UnsupportedMediaTypeError(info.content_type)

        data = await self._files.download_file(source_key)
        audio = await self._videos.extract_audio(
            data=data,
            output_format=output_format,
            bitrate=bitrate,
            input_ext=info.extension,
        )
        stored = await self._files.upload_file(
            filename=f"audio.{output_format}",
            data=audio,
            content_type=f"audio/{output_format}",
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "audio_extract"},
        )
        return stored.key

    async def create_gif_from_video(
        self,
        source_key: str,
        start_seconds: float = 0.0,
        duration_seconds: float = 5.0,
        width: int = 480,
        fps: int = 10,
        result_prefix: str = "processed/gifs",
    ) -> str:
        """Create an animated GIF from a video segment."""
        info = await self._files.get_file_info(source_key)
        if not info.is_video:
            raise UnsupportedMediaTypeError(info.content_type)

        data = await self._files.download_file(source_key)
        gif = await self._videos.create_gif(
            data=data,
            start_seconds=start_seconds,
            duration_seconds=duration_seconds,
            width=width,
            fps=fps,
            input_ext=info.extension,
        )
        stored = await self._files.upload_file(
            filename="animation.gif",
            data=gif,
            content_type="image/gif",
            prefix=result_prefix,
            metadata={"source_key": source_key, "operation": "gif_create"},
        )
        return stored.key

    async def get_video_metadata(self, source_key: str) -> VideoMetadata:
        """Return FFprobe-extracted metadata for a stored video."""
        info = await self._files.get_file_info(source_key)
        data = await self._files.download_file(source_key)
        return await self._videos.get_metadata(data, input_ext=info.extension)
