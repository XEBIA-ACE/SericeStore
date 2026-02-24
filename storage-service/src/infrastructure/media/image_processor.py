"""
Image processing using ImageMagick via the Wand Python binding.
Wand wraps the ImageMagick C library and supports a full range of
image operations including resize, crop, convert, thumbnail, watermark, etc.
"""
import asyncio
import io
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from typing import Optional

from wand.color import Color
from wand.image import Image

from src.core.config import get_settings
from src.core.exceptions import ImageProcessingError, UnsupportedMediaTypeError
from src.core.logging import get_logger
from src.domain.models.media import ImageFormat, ImageMetadata

logger = get_logger(__name__)

# Run blocking ImageMagick operations in a thread pool
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="imagemagick")


def _run_sync(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, partial(func, *args, **kwargs))


class ImageProcessor:
    """Async image processing adapter using ImageMagick / Wand."""

    def __init__(self) -> None:
        self._settings = get_settings()

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    async def resize(
        self,
        data: bytes,
        width: int,
        height: int,
        maintain_aspect: bool = True,
        output_format: Optional[ImageFormat] = None,
        quality: Optional[int] = None,
    ) -> bytes:
        """
        Resize an image to the given dimensions.

        Args:
            data: Raw image bytes.
            width: Target width in pixels.
            height: Target height in pixels.
            maintain_aspect: If True, resize to fit within the box
                             while preserving aspect ratio.
            output_format: Desired output format; defaults to original format.
            quality: JPEG/WebP quality 1–100; defaults to settings value.

        Returns:
            Resized image bytes.
        """
        def _do_resize():
            with Image(blob=data) as img:
                if maintain_aspect:
                    img.transform(resize=f"{width}x{height}")
                else:
                    img.resize(width, height)

                if output_format:
                    img.format = output_format.value

                q = quality or self._settings.image_quality_default
                img.compression_quality = q
                return img.make_blob()

        try:
            result = await _run_sync(_do_resize)
            logger.info("image_resize_success", width=width, height=height)
            return result
        except Exception as exc:
            logger.error("image_resize_failed", error=str(exc))
            raise ImageProcessingError(f"Image resize failed: {exc}") from exc

    async def thumbnail(
        self,
        data: bytes,
        width: Optional[int] = None,
        height: Optional[int] = None,
        quality: Optional[int] = None,
    ) -> bytes:
        """
        Create a thumbnail by resizing and stripping EXIF metadata.
        Defaults to configured thumbnail dimensions.
        """
        w = width or self._settings.thumbnail_width
        h = height or self._settings.thumbnail_height

        def _do_thumbnail():
            with Image(blob=data) as img:
                img.strip()  # Remove EXIF/IPTC metadata
                img.transform(resize=f"{w}x{h}")
                img.compression_quality = quality or self._settings.image_quality_default
                return img.make_blob()

        try:
            result = await _run_sync(_do_thumbnail)
            logger.info("image_thumbnail_success", width=w, height=h)
            return result
        except Exception as exc:
            raise ImageProcessingError(f"Thumbnail creation failed: {exc}") from exc

    async def convert(
        self,
        data: bytes,
        output_format: ImageFormat,
        quality: Optional[int] = None,
    ) -> bytes:
        """Convert an image to a different format."""
        def _do_convert():
            with Image(blob=data) as img:
                img.format = output_format.value
                img.compression_quality = quality or self._settings.image_quality_default
                return img.make_blob()

        try:
            result = await _run_sync(_do_convert)
            logger.info("image_convert_success", format=output_format.value)
            return result
        except Exception as exc:
            raise ImageProcessingError(f"Image conversion failed: {exc}") from exc

    async def crop(
        self,
        data: bytes,
        left: int,
        top: int,
        width: int,
        height: int,
        output_format: Optional[ImageFormat] = None,
    ) -> bytes:
        """Crop an image to the specified rectangle."""
        def _do_crop():
            with Image(blob=data) as img:
                img.crop(left, top, left + width, top + height)
                if output_format:
                    img.format = output_format.value
                return img.make_blob()

        try:
            result = await _run_sync(_do_crop)
            logger.info("image_crop_success", region=f"{left},{top},{width},{height}")
            return result
        except Exception as exc:
            raise ImageProcessingError(f"Image crop failed: {exc}") from exc

    async def rotate(
        self,
        data: bytes,
        degrees: float,
        background_color: str = "white",
        output_format: Optional[ImageFormat] = None,
    ) -> bytes:
        """Rotate an image by the specified degrees."""
        def _do_rotate():
            with Image(blob=data) as img:
                img.rotate(degrees, background=Color(background_color))
                if output_format:
                    img.format = output_format.value
                return img.make_blob()

        try:
            result = await _run_sync(_do_rotate)
            logger.info("image_rotate_success", degrees=degrees)
            return result
        except Exception as exc:
            raise ImageProcessingError(f"Image rotation failed: {exc}") from exc

    async def flip(self, data: bytes, horizontal: bool = False, vertical: bool = False) -> bytes:
        """Flip an image horizontally and/or vertically."""
        def _do_flip():
            with Image(blob=data) as img:
                if horizontal:
                    img.flop()
                if vertical:
                    img.flip()
                return img.make_blob()

        try:
            return await _run_sync(_do_flip)
        except Exception as exc:
            raise ImageProcessingError(f"Image flip failed: {exc}") from exc

    async def grayscale(self, data: bytes) -> bytes:
        """Convert an image to grayscale."""
        def _do_grayscale():
            with Image(blob=data) as img:
                img.transform_colorspace("gray")
                return img.make_blob()

        try:
            return await _run_sync(_do_grayscale)
        except Exception as exc:
            raise ImageProcessingError(f"Grayscale conversion failed: {exc}") from exc

    async def watermark(
        self,
        data: bytes,
        watermark_data: bytes,
        gravity: str = "south_east",
        opacity: float = 0.5,
        offset_x: int = 10,
        offset_y: int = 10,
    ) -> bytes:
        """Overlay a watermark image onto the source image."""
        def _do_watermark():
            with Image(blob=data) as base:
                with Image(blob=watermark_data) as wm:
                    wm.evaluate("multiply", opacity)
                    # Map gravity string to (x, y) coordinate
                    bw, bh = base.width, base.height
                    ww, wh = wm.width, wm.height
                    gravity_map = {
                        "north_west": (offset_x, offset_y),
                        "north": ((bw - ww) // 2, offset_y),
                        "north_east": (bw - ww - offset_x, offset_y),
                        "west": (offset_x, (bh - wh) // 2),
                        "center": ((bw - ww) // 2, (bh - wh) // 2),
                        "east": (bw - ww - offset_x, (bh - wh) // 2),
                        "south_west": (offset_x, bh - wh - offset_y),
                        "south": ((bw - ww) // 2, bh - wh - offset_y),
                        "south_east": (bw - ww - offset_x, bh - wh - offset_y),
                    }
                    x, y = gravity_map.get(gravity, (offset_x, offset_y))
                    base.composite(wm, left=x, top=y)
                return base.make_blob()

        try:
            result = await _run_sync(_do_watermark)
            logger.info("image_watermark_success")
            return result
        except Exception as exc:
            raise ImageProcessingError(f"Image watermark failed: {exc}") from exc

    async def strip_metadata(self, data: bytes) -> bytes:
        """Strip all metadata (EXIF, IPTC, XMP) from an image."""
        def _do_strip():
            with Image(blob=data) as img:
                img.strip()
                return img.make_blob()

        try:
            return await _run_sync(_do_strip)
        except Exception as exc:
            raise ImageProcessingError(f"Metadata stripping failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Metadata extraction
    # ------------------------------------------------------------------

    async def get_metadata(self, data: bytes) -> ImageMetadata:
        """Extract image metadata using ImageMagick's identify functionality."""
        def _do_identify():
            with Image(blob=data) as img:
                return ImageMetadata(
                    width=img.width,
                    height=img.height,
                    format=img.format,
                    color_space=img.colorspace,
                    depth=img.depth,
                    size_bytes=len(data),
                    has_alpha=img.alpha_channel,
                    dpi=(int(img.resolution[0]), int(img.resolution[1]))
                    if img.resolution
                    else None,
                    exif={
                        k: v
                        for k, v in img.metadata.items()
                        if k.startswith("exif:")
                    },
                )

        try:
            return await _run_sync(_do_identify)
        except Exception as exc:
            raise ImageProcessingError(f"Metadata extraction failed: {exc}") from exc
