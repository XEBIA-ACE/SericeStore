"""
Video (and audio) processing using FFmpeg via the ffmpeg-python wrapper.
All operations are run in a thread pool to avoid blocking the event loop.
"""
import asyncio
import json
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from typing import Optional

import ffmpeg

from src.core.config import get_settings
from src.core.exceptions import VideoProcessingError
from src.core.logging import get_logger
from src.domain.models.media import VideoMetadata

logger = get_logger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ffmpeg")


def _run_sync(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, partial(func, *args, **kwargs))


class VideoProcessor:
    """Async video/audio processing adapter using FFmpeg."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._ffmpeg = self._settings.ffmpeg_path
        self._ffprobe = self._settings.ffprobe_path
        self._temp_dir = self._settings.temp_dir

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _make_temp_input(self, data: bytes, suffix: str) -> str:
        """Write bytes to a named temp file and return its path."""
        tmp = tempfile.NamedTemporaryFile(
            delete=False,
            dir=self._temp_dir,
            suffix=suffix,
        )
        tmp.write(data)
        tmp.flush()
        tmp.close()
        return tmp.name

    def _read_and_cleanup(self, path: str) -> bytes:
        """Read file, delete it, and return its content."""
        try:
            with open(path, "rb") as f:
                return f.read()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Metadata extraction
    # ------------------------------------------------------------------

    async def get_metadata(self, data: bytes, input_ext: str = ".mp4") -> VideoMetadata:
        """
        Extract video metadata using ffprobe.

        Args:
            data: Raw video bytes.
            input_ext: File extension hint for FFmpeg demuxer selection.
        """
        def _do_probe():
            tmp_in = self._make_temp_input(data, input_ext)
            try:
                probe = ffmpeg.probe(tmp_in, cmd=self._ffprobe)
                video_stream = next(
                    (s for s in probe["streams"] if s.get("codec_type") == "video"),
                    None,
                )
                audio_stream = next(
                    (s for s in probe["streams"] if s.get("codec_type") == "audio"),
                    None,
                )
                fmt = probe.get("format", {})
                # Parse FPS from "num/den" string
                fps = 0.0
                if video_stream:
                    raw_fps = video_stream.get("r_frame_rate", "0/1")
                    num, den = raw_fps.split("/")
                    fps = float(num) / float(den) if float(den) else 0.0

                return VideoMetadata(
                    duration_seconds=float(fmt.get("duration", 0)),
                    width=int(video_stream.get("width", 0)) if video_stream else 0,
                    height=int(video_stream.get("height", 0)) if video_stream else 0,
                    fps=fps,
                    video_codec=video_stream.get("codec_name", "unknown") if video_stream else "none",
                    audio_codec=audio_stream.get("codec_name") if audio_stream else None,
                    bitrate_kbps=int(fmt.get("bit_rate", 0)) // 1000,
                    size_bytes=int(fmt.get("size", len(data))),
                    format=fmt.get("format_name", "unknown"),
                    streams=probe.get("streams", []),
                )
            finally:
                try:
                    os.unlink(tmp_in)
                except OSError:
                    pass

        try:
            return await _run_sync(_do_probe)
        except ffmpeg.Error as exc:
            raise VideoProcessingError(f"FFprobe failed: {exc.stderr.decode() if exc.stderr else exc}") from exc
        except Exception as exc:
            raise VideoProcessingError(f"Metadata extraction failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Transcode
    # ------------------------------------------------------------------

    async def transcode(
        self,
        data: bytes,
        output_format: str = "mp4",
        video_codec: str = "libx264",
        audio_codec: str = "aac",
        crf: Optional[int] = None,
        preset: Optional[str] = None,
        audio_bitrate: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        input_ext: str = ".mp4",
    ) -> bytes:
        """
        Transcode a video to the specified format and codec settings.

        Args:
            data: Input video bytes.
            output_format: Container format (mp4, webm, mkv …).
            video_codec: Video codec (libx264, libvpx-vp9, hevc …).
            audio_codec: Audio codec (aac, libopus, mp3 …).
            crf: Constant Rate Factor (quality). Lower = better.
            preset: Encoding speed preset (ultrafast … veryslow).
            audio_bitrate: Audio bitrate string e.g. "128k".
            width: Output width; height auto-calculated if only width given.
            height: Output height.
            input_ext: Input file extension hint.

        Returns:
            Transcoded video bytes.
        """
        effective_crf = crf if crf is not None else self._settings.video_crf_default
        effective_preset = preset or self._settings.video_preset_default
        effective_audio_bitrate = audio_bitrate or self._settings.audio_bitrate_default

        def _do_transcode():
            tmp_in = self._make_temp_input(data, input_ext)
            tmp_out = tempfile.mktemp(dir=self._temp_dir, suffix=f".{output_format}")
            try:
                stream = ffmpeg.input(tmp_in)

                video_kwargs: dict = {
                    "vcodec": video_codec,
                    "crf": effective_crf,
                    "preset": effective_preset,
                }
                if width and height:
                    video_kwargs["vf"] = f"scale={width}:{height}"
                elif width:
                    video_kwargs["vf"] = f"scale={width}:-2"
                elif height:
                    video_kwargs["vf"] = f"scale=-2:{height}"

                audio_kwargs = {
                    "acodec": audio_codec,
                    "audio_bitrate": effective_audio_bitrate,
                }

                out = ffmpeg.output(
                    stream,
                    tmp_out,
                    **video_kwargs,
                    **audio_kwargs,
                )
                ffmpeg.run(
                    out,
                    overwrite_output=True,
                    cmd=self._ffmpeg,
                    quiet=True,
                )
                return self._read_and_cleanup(tmp_out)
            finally:
                for p in (tmp_in, tmp_out):
                    try:
                        os.unlink(p)
                    except OSError:
                        pass

        try:
            result = await _run_sync(_do_transcode)
            logger.info("video_transcode_success", format=output_format, codec=video_codec)
            return result
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode() if exc.stderr else str(exc)
            logger.error("video_transcode_failed", error=stderr)
            raise VideoProcessingError(f"FFmpeg transcode failed: {stderr}") from exc

    # ------------------------------------------------------------------
    # Thumbnail (frame extraction)
    # ------------------------------------------------------------------

    async def extract_frame(
        self,
        data: bytes,
        timestamp_seconds: float = 1.0,
        width: Optional[int] = None,
        height: Optional[int] = None,
        output_format: str = "jpg",
        input_ext: str = ".mp4",
    ) -> bytes:
        """Extract a single frame from a video at the given timestamp."""
        def _do_extract():
            tmp_in = self._make_temp_input(data, input_ext)
            tmp_out = tempfile.mktemp(dir=self._temp_dir, suffix=f".{output_format}")
            try:
                stream = ffmpeg.input(tmp_in, ss=timestamp_seconds)
                vf_opts = []
                if width and height:
                    vf_opts.append(f"scale={width}:{height}")
                elif width:
                    vf_opts.append(f"scale={width}:-2")
                elif height:
                    vf_opts.append(f"scale=-2:{height}")

                out_kwargs: dict = {"vframes": 1}
                if vf_opts:
                    out_kwargs["vf"] = ",".join(vf_opts)

                out = ffmpeg.output(stream, tmp_out, **out_kwargs)
                ffmpeg.run(out, overwrite_output=True, cmd=self._ffmpeg, quiet=True)
                return self._read_and_cleanup(tmp_out)
            finally:
                try:
                    os.unlink(tmp_in)
                except OSError:
                    pass

        try:
            result = await _run_sync(_do_extract)
            logger.info("video_frame_extract_success", timestamp=timestamp_seconds)
            return result
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode() if exc.stderr else str(exc)
            raise VideoProcessingError(f"Frame extraction failed: {stderr}") from exc

    # ------------------------------------------------------------------
    # Audio extraction
    # ------------------------------------------------------------------

    async def extract_audio(
        self,
        data: bytes,
        output_format: str = "mp3",
        audio_codec: str = "libmp3lame",
        bitrate: Optional[str] = None,
        input_ext: str = ".mp4",
    ) -> bytes:
        """Extract the audio track from a video file."""
        effective_bitrate = bitrate or self._settings.audio_bitrate_default

        def _do_extract_audio():
            tmp_in = self._make_temp_input(data, input_ext)
            tmp_out = tempfile.mktemp(dir=self._temp_dir, suffix=f".{output_format}")
            try:
                stream = ffmpeg.input(tmp_in)
                out = ffmpeg.output(
                    stream,
                    tmp_out,
                    acodec=audio_codec,
                    audio_bitrate=effective_bitrate,
                    vn=None,  # Disable video
                )
                ffmpeg.run(out, overwrite_output=True, cmd=self._ffmpeg, quiet=True)
                return self._read_and_cleanup(tmp_out)
            finally:
                try:
                    os.unlink(tmp_in)
                except OSError:
                    pass

        try:
            result = await _run_sync(_do_extract_audio)
            logger.info("video_audio_extract_success", format=output_format)
            return result
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode() if exc.stderr else str(exc)
            raise VideoProcessingError(f"Audio extraction failed: {stderr}") from exc

    # ------------------------------------------------------------------
    # GIF creation
    # ------------------------------------------------------------------

    async def create_gif(
        self,
        data: bytes,
        start_seconds: float = 0.0,
        duration_seconds: float = 5.0,
        width: int = 480,
        fps: int = 10,
        input_ext: str = ".mp4",
    ) -> bytes:
        """Create an animated GIF from a video segment."""
        def _do_gif():
            tmp_in = self._make_temp_input(data, input_ext)
            tmp_out = tempfile.mktemp(dir=self._temp_dir, suffix=".gif")
            try:
                stream = ffmpeg.input(tmp_in, ss=start_seconds, t=duration_seconds)
                out = ffmpeg.output(
                    stream,
                    tmp_out,
                    vf=f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                    loop=0,
                )
                ffmpeg.run(out, overwrite_output=True, cmd=self._ffmpeg, quiet=True)
                return self._read_and_cleanup(tmp_out)
            finally:
                try:
                    os.unlink(tmp_in)
                except OSError:
                    pass

        try:
            result = await _run_sync(_do_gif)
            logger.info("video_gif_create_success", width=width, fps=fps)
            return result
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode() if exc.stderr else str(exc)
            raise VideoProcessingError(f"GIF creation failed: {stderr}") from exc
