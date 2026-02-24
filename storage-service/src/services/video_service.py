"""
Video processing service using FFmpeg and FFprobe.

Handles thumbnail extraction, format transcoding, clip cutting, and metadata
probing. All subprocess calls run in the thread-pool executor.
"""

import asyncio
import json
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Optional

from src.core.config import Settings
from src.core.exceptions import MediaProbeError, VideoProcessingError
from src.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class VideoInfo:
    """Metadata extracted from a video or audio file."""
    duration_seconds: float
    width: Optional[int]
    height: Optional[int]
    codec_video: Optional[str]
    codec_audio: Optional[str]
    bitrate_kbps: Optional[int]
    fps: Optional[float]
    size_bytes: int
    format_name: str
    extra: dict = field(default_factory=dict)


@dataclass
class ProcessedVideo:
    """Result of a video processing operation."""
    data: bytes
    content_type: str
    format: str


class VideoService:
    """
    High-level video processing service backed by FFmpeg / FFprobe.

    All heavy I/O is done through temporary files (created with the stdlib
    ``tempfile`` module) to support arbitrary codec/container combinations.
    Temp files are always cleaned up in finally blocks.
    """

    _FORMAT_MIME: dict[str, str] = {
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "avi": "video/x-msvideo",
        "mkv": "video/x-matroska",
        "gif": "image/gif",
        "mp3": "audio/mpeg",
        "aac": "audio/aac",
        "ogg": "audio/ogg",
        "wav": "audio/wav",
    }

    def __init__(self, settings: Settings) -> None:
        self._ffmpeg = settings.ffmpeg_binary
        self._ffprobe = settings.ffprobe_binary
        self._max_duration = settings.video_max_duration_seconds
        self._thumb_offset = settings.video_thumbnail_time_offset

    # ── Internal helpers ────────────────────────────────────────────────────

    async def _run(
        self,
        args: list[str],
        stdin: Optional[bytes] = None,
    ) -> tuple[bytes, bytes]:
        """Run an FFmpeg/FFprobe command, returning (stdout, stderr)."""
        loop = asyncio.get_event_loop()

        def _exec():
            result = subprocess.run(
                args,
                input=stdin,
                capture_output=True,
                timeout=300,
            )
            return result.returncode, result.stdout, result.stderr

        try:
            code, stdout, stderr = await loop.run_in_executor(None, _exec)
        except subprocess.TimeoutExpired as exc:
            raise VideoProcessingError("FFmpeg timed out after 300 s") from exc
        except FileNotFoundError as exc:
            raise VideoProcessingError(
                f"FFmpeg binary not found: {args[0]!r}"
            ) from exc

        if code != 0:
            raise VideoProcessingError(
                f"FFmpeg exited {code}: {stderr.decode(errors='replace').strip()[-500:]}"
            )
        return stdout, stderr

    def _mime(self, fmt: str) -> str:
        return self._FORMAT_MIME.get(fmt.lower(), "application/octet-stream")

    # ── Public API ───────────────────────────────────────────────────────────

    async def probe(self, data: bytes) -> VideoInfo:
        """
        Extract metadata from a video/audio file using FFprobe.

        Args:
            data: Raw media bytes.

        Returns:
            :class:`VideoInfo` with streams and container information.
        """
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        try:
            args = [
                self._ffprobe,
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                tmp_path,
            ]
            stdout, _ = await self._run(args)
        except VideoProcessingError as exc:
            raise MediaProbeError(f"FFprobe failed: {exc}") from exc
        finally:
            os.unlink(tmp_path)

        try:
            meta = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise MediaProbeError("FFprobe returned invalid JSON") from exc

        fmt = meta.get("format", {})
        streams = meta.get("streams", [])

        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        duration = float(fmt.get("duration", 0))
        if duration > self._max_duration:
            raise VideoProcessingError(
                f"Video duration {duration:.0f}s exceeds maximum {self._max_duration}s"
            )

        fps: Optional[float] = None
        if video_stream and "r_frame_rate" in video_stream:
            try:
                num, den = video_stream["r_frame_rate"].split("/")
                fps = round(int(num) / int(den), 3) if int(den) else None
            except (ValueError, ZeroDivisionError):
                pass

        logger.debug("video.probe_ok", duration=duration, format=fmt.get("format_name"))
        return VideoInfo(
            duration_seconds=duration,
            width=video_stream.get("width") if video_stream else None,
            height=video_stream.get("height") if video_stream else None,
            codec_video=video_stream.get("codec_name") if video_stream else None,
            codec_audio=audio_stream.get("codec_name") if audio_stream else None,
            bitrate_kbps=int(int(fmt.get("bit_rate", 0)) / 1000) or None,
            fps=fps,
            size_bytes=len(data),
            format_name=fmt.get("format_name", "unknown"),
            extra={"streams": streams},
        )

    async def extract_thumbnail(
        self,
        data: bytes,
        time_offset: Optional[str] = None,
        width: int = 640,
    ) -> bytes:
        """
        Extract a single JPEG frame from a video at the given time offset.

        Args:
            data:        Raw video bytes.
            time_offset: HH:MM:SS or seconds (defaults to config value).
            width:       Output thumbnail width (height scaled proportionally).

        Returns:
            JPEG bytes of the thumbnail.
        """
        offset = time_offset or self._thumb_offset

        with tempfile.NamedTemporaryFile(suffix=".video", delete=False) as src_tmp, \
             tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as out_tmp:
            src_tmp.write(data)
            src_path = src_tmp.name
            out_path = out_tmp.name

        try:
            args = [
                self._ffmpeg,
                "-y",
                "-ss", offset,
                "-i", src_path,
                "-vframes", "1",
                "-vf", f"scale={width}:-1",
                "-q:v", "2",
                out_path,
            ]
            await self._run(args)
            with open(out_path, "rb") as f:
                thumb = f.read()
        finally:
            os.unlink(src_path)
            os.unlink(out_path)

        logger.info("video.thumbnail_ok", offset=offset, size=len(thumb))
        return thumb

    async def transcode(
        self,
        data: bytes,
        output_format: str = "mp4",
        video_codec: str = "libx264",
        audio_codec: str = "aac",
        crf: int = 23,
        preset: str = "fast",
        max_width: Optional[int] = None,
    ) -> ProcessedVideo:
        """
        Transcode a video to a different format or codec.

        Args:
            data:          Source video bytes.
            output_format: Container format (e.g. "mp4", "webm").
            video_codec:   FFmpeg video encoder name.
            audio_codec:   FFmpeg audio encoder name.
            crf:           Constant Rate Factor (quality; lower = better).
            preset:        FFmpeg speed/quality preset.
            max_width:     Optional width cap (height auto-scaled).

        Returns:
            :class:`ProcessedVideo` with transcoded bytes.
        """
        with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as src_tmp, \
             tempfile.NamedTemporaryFile(suffix=f".{output_format}", delete=False) as out_tmp:
            src_tmp.write(data)
            src_path = src_tmp.name
            out_path = out_tmp.name

        try:
            vf_args = []
            if max_width:
                # Scale width, keep aspect ratio, ensure even dimensions
                vf_args = ["-vf", f"scale='min({max_width},iw)':-2"]

            args = [
                self._ffmpeg,
                "-y",
                "-i", src_path,
                "-c:v", video_codec,
                "-crf", str(crf),
                "-preset", preset,
                "-c:a", audio_codec,
                "-movflags", "+faststart",
                *vf_args,
                out_path,
            ]
            await self._run(args)
            with open(out_path, "rb") as f:
                result = f.read()
        finally:
            os.unlink(src_path)
            os.unlink(out_path)

        logger.info("video.transcode_ok", format=output_format, size=len(result))
        return ProcessedVideo(
            data=result,
            content_type=self._mime(output_format),
            format=output_format,
        )

    async def clip(
        self,
        data: bytes,
        start: str,
        duration: str,
        output_format: str = "mp4",
    ) -> ProcessedVideo:
        """
        Cut a clip from a video.

        Args:
            data:          Source video bytes.
            start:         Start position (HH:MM:SS or seconds).
            duration:      Clip length (HH:MM:SS or seconds).
            output_format: Output container format.

        Returns:
            :class:`ProcessedVideo` with clip bytes.
        """
        with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as src_tmp, \
             tempfile.NamedTemporaryFile(suffix=f".{output_format}", delete=False) as out_tmp:
            src_tmp.write(data)
            src_path = src_tmp.name
            out_path = out_tmp.name

        try:
            args = [
                self._ffmpeg,
                "-y",
                "-ss", start,
                "-i", src_path,
                "-t", duration,
                "-c", "copy",          # stream copy for speed
                "-avoid_negative_ts", "make_zero",
                out_path,
            ]
            await self._run(args)
            with open(out_path, "rb") as f:
                result = f.read()
        finally:
            os.unlink(src_path)
            os.unlink(out_path)

        logger.info("video.clip_ok", start=start, duration=duration)
        return ProcessedVideo(
            data=result,
            content_type=self._mime(output_format),
            format=output_format,
        )

    async def extract_audio(
        self,
        data: bytes,
        output_format: str = "mp3",
        bitrate: str = "192k",
    ) -> ProcessedVideo:
        """
        Strip the audio track from a video file.

        Args:
            data:          Source video bytes.
            output_format: Audio format ("mp3", "aac", "ogg").
            bitrate:       Audio bitrate (e.g. "192k").
        """
        with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as src_tmp, \
             tempfile.NamedTemporaryFile(suffix=f".{output_format}", delete=False) as out_tmp:
            src_tmp.write(data)
            src_path = src_tmp.name
            out_path = out_tmp.name

        try:
            args = [
                self._ffmpeg,
                "-y",
                "-i", src_path,
                "-vn",                 # no video
                "-b:a", bitrate,
                out_path,
            ]
            await self._run(args)
            with open(out_path, "rb") as f:
                result = f.read()
        finally:
            os.unlink(src_path)
            os.unlink(out_path)

        logger.info("video.extract_audio_ok", format=output_format)
        return ProcessedVideo(
            data=result,
            content_type=self._mime(output_format),
            format=output_format,
        )
