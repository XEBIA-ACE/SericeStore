"""
Domain models for media processing jobs and results.
"""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ImageFormat(str, Enum):
    JPEG = "jpeg"
    PNG = "png"
    WEBP = "webp"
    GIF = "gif"
    BMP = "bmp"
    TIFF = "tiff"


class VideoFormat(str, Enum):
    MP4 = "mp4"
    WEBM = "webm"
    MKV = "mkv"
    AVI = "avi"
    MOV = "mov"


@dataclass
class ImageMetadata:
    """Metadata extracted from an image by ImageMagick."""
    width: int
    height: int
    format: str
    color_space: str
    depth: int
    size_bytes: int
    has_alpha: bool = False
    dpi: Optional[tuple[int, int]] = None
    exif: dict = field(default_factory=dict)


@dataclass
class VideoMetadata:
    """Metadata extracted from a video by FFprobe."""
    duration_seconds: float
    width: int
    height: int
    fps: float
    video_codec: str
    audio_codec: Optional[str]
    bitrate_kbps: int
    size_bytes: int
    format: str
    streams: list[dict] = field(default_factory=list)


@dataclass
class ProcessingJob:
    """Represents an async media processing operation."""
    source_key: str
    operation: str           # "resize", "convert", "thumbnail", "transcode", etc.
    parameters: dict
    id: str = field(default_factory=lambda: str(uuid4()))
    status: ProcessingStatus = ProcessingStatus.PENDING
    result_key: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_key": self.source_key,
            "operation": self.operation,
            "parameters": self.parameters,
            "status": self.status.value,
            "result_key": self.result_key,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
