"""
Pydantic request/response schemas for media processing endpoints.
"""
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from src.domain.models.media import ImageFormat, VideoFormat


# ---------------------------------------------------------------------------
# Image schemas
# ---------------------------------------------------------------------------

class ImageResizeRequest(BaseModel):
    source_key: str = Field(..., description="Storage key of the source image")
    width: int = Field(..., ge=1, le=10000, description="Target width in pixels")
    height: int = Field(..., ge=1, le=10000, description="Target height in pixels")
    maintain_aspect: bool = Field(True, description="Preserve aspect ratio")
    output_format: Optional[ImageFormat] = Field(None, description="Output image format")
    quality: Optional[int] = Field(None, ge=1, le=100, description="JPEG/WebP quality")
    result_prefix: str = Field("processed/images", max_length=256)


class ImageConvertRequest(BaseModel):
    source_key: str
    output_format: ImageFormat
    quality: Optional[int] = Field(None, ge=1, le=100)
    result_prefix: str = Field("processed/images", max_length=256)


class ImageCropRequest(BaseModel):
    source_key: str
    left: int = Field(..., ge=0)
    top: int = Field(..., ge=0)
    width: int = Field(..., ge=1, le=10000)
    height: int = Field(..., ge=1, le=10000)
    result_prefix: str = Field("processed/images", max_length=256)


class ImageThumbnailRequest(BaseModel):
    source_key: str
    width: Optional[int] = Field(None, ge=1, le=4000)
    height: Optional[int] = Field(None, ge=1, le=4000)
    result_prefix: str = Field("processed/thumbnails", max_length=256)


class ImageWatermarkRequest(BaseModel):
    source_key: str
    watermark_key: str
    gravity: str = Field(
        "south_east",
        pattern=r"^(north_west|north|north_east|west|center|east|south_west|south|south_east)$",
    )
    opacity: float = Field(0.5, ge=0.0, le=1.0)
    result_prefix: str = Field("processed/images", max_length=256)


class ImageMetadataResponse(BaseModel):
    width: int
    height: int
    format: str
    color_space: str
    depth: int
    size_bytes: int
    has_alpha: bool
    dpi: Optional[tuple[int, int]] = None
    exif: dict = Field(default_factory=dict)


class MediaProcessingResponse(BaseModel):
    """Generic response for any media processing operation that produces a new stored file."""
    source_key: str
    result_key: str
    operation: str


# ---------------------------------------------------------------------------
# Video schemas
# ---------------------------------------------------------------------------

class VideoTranscodeRequest(BaseModel):
    source_key: str
    output_format: VideoFormat = VideoFormat.MP4
    video_codec: str = Field("libx264", max_length=64)
    audio_codec: str = Field("aac", max_length=64)
    crf: Optional[int] = Field(None, ge=0, le=51)
    preset: Optional[str] = Field(None, pattern=r"^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow)$")
    width: Optional[int] = Field(None, ge=1, le=7680)
    height: Optional[int] = Field(None, ge=1, le=4320)
    result_prefix: str = Field("processed/videos", max_length=256)


class VideoFrameRequest(BaseModel):
    source_key: str
    timestamp_seconds: float = Field(1.0, ge=0.0)
    width: Optional[int] = Field(None, ge=1, le=7680)
    height: Optional[int] = Field(None, ge=1, le=4320)
    result_prefix: str = Field("processed/thumbnails", max_length=256)


class AudioExtractRequest(BaseModel):
    source_key: str
    output_format: str = Field("mp3", pattern=r"^(mp3|aac|ogg|flac|wav|m4a)$")
    bitrate: Optional[str] = Field(None, pattern=r"^\d+k$")
    result_prefix: str = Field("processed/audio", max_length=256)


class GifCreateRequest(BaseModel):
    source_key: str
    start_seconds: float = Field(0.0, ge=0.0)
    duration_seconds: float = Field(5.0, ge=0.1, le=30.0)
    width: int = Field(480, ge=64, le=1920)
    fps: int = Field(10, ge=1, le=30)
    result_prefix: str = Field("processed/gifs", max_length=256)


class VideoMetadataResponse(BaseModel):
    duration_seconds: float
    width: int
    height: int
    fps: float
    video_codec: str
    audio_codec: Optional[str]
    bitrate_kbps: int
    size_bytes: int
    format: str
