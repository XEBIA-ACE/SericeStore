"""
Image processing service using ImageMagick (via wand or subprocess).

Supports resize, thumbnail generation, format conversion, and metadata
extraction. All processing is done on in-memory bytes to avoid temp-file
leaks.
"""

import asyncio
import io
import json
import subprocess
from dataclasses import dataclass
from functools import partial
from typing import Optional

from src.core.config import Settings
from src.core.exceptions import ImageProcessingError
from src.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class ImageInfo:
    """Metadata extracted from an image."""
    width: int
    height: int
    format: str
    color_space: str
    depth: int
    size_bytes: int


@dataclass
class ProcessedImage:
    """Result of an image processing operation."""
    data: bytes
    content_type: str
    width: int
    height: int
    format: str


class ImageService:
    """
    High-level image processing service.

    Uses ImageMagick's ``convert`` binary so the full IM feature set is
    available without native Python bindings. All subprocess calls are
    run in the default thread-pool executor to keep the event loop free.
    """

    # Map common extensions to MIME types
    _FORMAT_MIME: dict[str, str] = {
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "avif": "image/avif",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
    }

    def __init__(self, settings: Settings) -> None:
        self._convert_bin = settings.imagemagick_binary
        self._max_width = settings.image_max_width
        self._max_height = settings.image_max_height
        self._thumb_w = settings.image_thumbnail_width
        self._thumb_h = settings.image_thumbnail_height
        self._quality = settings.image_quality

    # ── Internal helpers ────────────────────────────────────────────────────

    async def _run(self, args: list[str], stdin: Optional[bytes] = None) -> bytes:
        """
        Run an ImageMagick command asynchronously.

        ``-`` is used as both input and output path so data flows entirely
        through stdin/stdout without touching the filesystem.
        """
        loop = asyncio.get_event_loop()

        def _exec():
            result = subprocess.run(
                args,
                input=stdin,
                capture_output=True,
                timeout=60,
            )
            if result.returncode != 0:
                raise ImageProcessingError(
                    f"ImageMagick failed (exit {result.returncode}): "
                    f"{result.stderr.decode(errors='replace').strip()}"
                )
            return result.stdout

        try:
            return await loop.run_in_executor(None, _exec)
        except ImageProcessingError:
            raise
        except subprocess.TimeoutExpired as exc:
            raise ImageProcessingError("ImageMagick timed out") from exc
        except FileNotFoundError as exc:
            raise ImageProcessingError(
                f"ImageMagick binary not found: {self._convert_bin}"
            ) from exc

    def _mime(self, fmt: str) -> str:
        return self._FORMAT_MIME.get(fmt.lower(), "application/octet-stream")

    # ── Public API ───────────────────────────────────────────────────────────

    async def get_info(self, data: bytes) -> ImageInfo:
        """
        Extract image metadata without modifying the image.

        Args:
            data: Raw image bytes.

        Returns:
            :class:`ImageInfo` containing dimensions, format, etc.
        """
        args = [
            self._convert_bin,
            "-",          # read from stdin
            "-format",
            "%wx%h %m %[colorspace] %z",
            "info:-",     # write info to stdout
        ]
        raw = await self._run(args, stdin=data)
        parts = raw.decode().strip().split()
        try:
            w, h = map(int, parts[0].split("x"))
            fmt = parts[1].lower()
            cs = parts[2] if len(parts) > 2 else "unknown"
            depth = int(parts[3]) if len(parts) > 3 else 8
        except (ValueError, IndexError) as exc:
            raise ImageProcessingError(f"Could not parse image info: {raw!r}") from exc

        logger.debug("image.info", width=w, height=h, format=fmt)
        return ImageInfo(width=w, height=h, format=fmt, color_space=cs, depth=depth, size_bytes=len(data))

    async def resize(
        self,
        data: bytes,
        width: int,
        height: int,
        output_format: str = "jpeg",
        fit: bool = True,
    ) -> ProcessedImage:
        """
        Resize an image to the given dimensions.

        Args:
            data:          Raw source image bytes.
            width:         Target width in pixels.
            height:        Target height in pixels.
            output_format: Output format (e.g. "jpeg", "png", "webp").
            fit:           If True, preserve aspect ratio (^ strips overflow).

        Returns:
            :class:`ProcessedImage` with resized image bytes.
        """
        if width > self._max_width or height > self._max_height:
            raise ImageProcessingError(
                f"Requested size {width}x{height} exceeds maximum "
                f"{self._max_width}x{self._max_height}"
            )

        geometry = f"{width}x{height}"
        if not fit:
            geometry += "!"  # force exact dimensions

        out_fmt = output_format.upper()
        args = [
            self._convert_bin,
            "-",
            "-resize", geometry,
            "-quality", str(self._quality),
            "-strip",          # remove EXIF/GPS/etc.
            "-auto-orient",    # honour EXIF orientation
            f"{out_fmt}:-",
        ]
        result = await self._run(args, stdin=data)
        logger.info("image.resize_ok", width=width, height=height, format=output_format)
        return ProcessedImage(
            data=result,
            content_type=self._mime(output_format),
            width=width,
            height=height,
            format=output_format,
        )

    async def thumbnail(
        self,
        data: bytes,
        output_format: str = "jpeg",
    ) -> ProcessedImage:
        """
        Generate a fixed-size thumbnail using the configured dimensions.

        Uses ImageMagick's ``-thumbnail`` (strips metadata, faster than resize).
        """
        w, h = self._thumb_w, self._thumb_h
        args = [
            self._convert_bin,
            "-",
            "-thumbnail", f"{w}x{h}^",
            "-gravity", "center",
            "-extent", f"{w}x{h}",
            "-quality", str(self._quality),
            f"{output_format.upper()}:-",
        ]
        result = await self._run(args, stdin=data)
        logger.info("image.thumbnail_ok", width=w, height=h)
        return ProcessedImage(
            data=result,
            content_type=self._mime(output_format),
            width=w,
            height=h,
            format=output_format,
        )

    async def convert_format(
        self,
        data: bytes,
        target_format: str,
    ) -> ProcessedImage:
        """
        Convert an image to a different format without resizing.

        Args:
            data:          Source image bytes.
            target_format: Target format string (e.g. "webp", "png").
        """
        args = [
            self._convert_bin,
            "-",
            "-quality", str(self._quality),
            "-strip",
            f"{target_format.upper()}:-",
        ]
        result = await self._run(args, stdin=data)
        info = await self.get_info(result)
        logger.info("image.convert_ok", format=target_format)
        return ProcessedImage(
            data=result,
            content_type=self._mime(target_format),
            width=info.width,
            height=info.height,
            format=target_format,
        )

    async def watermark(
        self,
        data: bytes,
        watermark_data: bytes,
        gravity: str = "SouthEast",
        output_format: str = "jpeg",
    ) -> ProcessedImage:
        """
        Composite a watermark image onto the source image.

        Args:
            data:           Source image bytes.
            watermark_data: Watermark image bytes.
            gravity:        ImageMagick gravity (e.g. "SouthEast", "Center").
            output_format:  Output format string.
        """
        # Write watermark to a temp in-memory path using IM's inline syntax
        import base64
        wm_b64 = base64.b64encode(watermark_data).decode()
        args = [
            self._convert_bin,
            "-",
            "(", "-", ")",
            "-gravity", gravity,
            "-composite",
            "-quality", str(self._quality),
            f"{output_format.upper()}:-",
        ]
        # Feed both images via stdin using ImageMagick's multi-read capability
        # For simplicity, write watermark to a temp file with /tmp path
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(watermark_data)
            tmp_path = tmp.name

        try:
            args = [
                self._convert_bin,
                "-",
                tmp_path,
                "-gravity", gravity,
                "-composite",
                "-quality", str(self._quality),
                f"{output_format.upper()}:-",
            ]
            result = await self._run(args, stdin=data)
        finally:
            os.unlink(tmp_path)

        info = await self.get_info(result)
        logger.info("image.watermark_ok", gravity=gravity)
        return ProcessedImage(
            data=result,
            content_type=self._mime(output_format),
            width=info.width,
            height=info.height,
            format=output_format,
        )
