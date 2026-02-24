"""
Pydantic request / response schemas.

Separating schemas from domain logic keeps the API layer thin and the
domain model free from serialisation concerns.
"""

from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator


# ── Generic ───────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    error: str
    message: str
    details: Optional[Any] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    storage_backend: str
    checks: dict[str, str]


# ── File / Object ─────────────────────────────────────────────────────────────

class ObjectMetadataResponse(BaseModel):
    key: str
    bucket: str
    size: int
    content_type: str
    etag: str
    url: str
    extra: dict = Field(default_factory=dict)


class PresignedUrlResponse(BaseModel):
    url: str
    expires_in_seconds: int
    method: str


class ListObjectsResponse(BaseModel):
    objects: list[ObjectMetadataResponse]
    count: int
    prefix: str


class DeleteResponse(BaseModel):
    key: str
    deleted: bool


# ── Image ─────────────────────────────────────────────────────────────────────

class ImageInfoResponse(BaseModel):
    width: int
    height: int
    format: str
    color_space: str
    depth: int
    size_bytes: int


class ImageResizeRequest(BaseModel):
    width: int = Field(gt=0, le=8192)
    height: int = Field(gt=0, le=8192)
    output_format: str = "jpeg"
    fit: bool = True

    @field_validator("output_format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        allowed = {"jpeg", "jpg", "png", "webp", "gif", "avif", "tiff", "bmp"}
        if v.lower() not in allowed:
            raise ValueError(f"output_format must be one of {sorted(allowed)}")
        return v.lower()


class ImageProcessResponse(BaseModel):
    key: str
    content_type: str
    width: int
    height: int
    format: str
    size: int
    url: str


# ── Video ─────────────────────────────────────────────────────────────────────

class VideoInfoResponse(BaseModel):
    duration_seconds: float
    width: Optional[int]
    height: Optional[int]
    codec_video: Optional[str]
    codec_audio: Optional[str]
    bitrate_kbps: Optional[int]
    fps: Optional[float]
    size_bytes: int
    format_name: str


class VideoTranscodeRequest(BaseModel):
    output_format: str = "mp4"
    video_codec: str = "libx264"
    audio_codec: str = "aac"
    crf: int = Field(default=23, ge=0, le=51)
    preset: str = "fast"
    max_width: Optional[int] = Field(default=None, gt=0)

    @field_validator("output_format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        allowed = {"mp4", "webm", "mov", "avi", "mkv"}
        if v.lower() not in allowed:
            raise ValueError(f"output_format must be one of {sorted(allowed)}")
        return v.lower()

    @field_validator("preset")
    @classmethod
    def validate_preset(cls, v: str) -> str:
        allowed = {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"}
        if v.lower() not in allowed:
            raise ValueError(f"preset must be one of {sorted(allowed)}")
        return v.lower()


class VideoClipRequest(BaseModel):
    start: str = Field(description="Start position: HH:MM:SS or seconds as string")
    duration: str = Field(description="Clip duration: HH:MM:SS or seconds as string")
    output_format: str = "mp4"


class VideoProcessResponse(BaseModel):
    key: str
    content_type: str
    format: str
    size: int
    url: str


# ── Presign ───────────────────────────────────────────────────────────────────

class PresignRequest(BaseModel):
    expires_in: int = Field(default=3600, ge=60, le=604800)  # 1 min – 7 days
    method: str = "GET"

    @field_validator("method")
    @classmethod
    def validate_method(cls, v: str) -> str:
        if v.upper() not in {"GET", "PUT"}:
            raise ValueError("method must be 'GET' or 'PUT'")
        return v.upper()
