"""
Core configuration module using pydantic-settings.
All configuration is sourced from environment variables.
"""
from enum import Enum
from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageBackend(str, Enum):
    S3 = "s3"
    GCS = "gcs"
    MINIO = "minio"


class Environment(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "SericeStore"
    app_version: str = "1.0.0"
    environment: Environment = Environment.DEVELOPMENT
    debug: bool = False
    log_level: str = "INFO"

    # API
    api_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 4
    allowed_origins: list[str] = ["*"]

    # Storage backend selection
    storage_backend: StorageBackend = StorageBackend.S3

    # AWS S3
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_region: str = "us-east-1"
    aws_s3_bucket: Optional[str] = None
    aws_s3_endpoint_url: Optional[str] = None  # for custom endpoints

    # Google Cloud Storage
    gcs_project_id: Optional[str] = None
    gcs_bucket: Optional[str] = None
    gcs_credentials_file: Optional[str] = None  # path to service account JSON

    # MinIO
    minio_endpoint: str = "localhost:9000"
    minio_access_key: Optional[str] = None
    minio_secret_key: Optional[str] = None
    minio_bucket: str = "sericestore"
    minio_secure: bool = False

    # File handling
    max_upload_size_mb: int = 500
    allowed_image_types: list[str] = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff"]
    allowed_video_types: list[str] = ["video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/x-msvideo"]
    allowed_audio_types: list[str] = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/aac", "audio/flac"]
    temp_dir: str = "/tmp/sericestore"

    # ImageMagick
    imagemagick_convert_path: str = "convert"
    imagemagick_identify_path: str = "identify"
    image_quality_default: int = 85
    thumbnail_width: int = 300
    thumbnail_height: int = 300

    # FFmpeg
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    video_crf_default: int = 23
    video_preset_default: str = "medium"
    audio_bitrate_default: str = "128k"

    # Presigned URL expiry (seconds)
    presigned_url_expiry: int = 3600

    # Authentication (placeholder — wire in your real auth provider)
    auth_enabled: bool = False
    auth_secret_key: str = "change-me-in-production"
    auth_algorithm: str = "HS256"
    auth_token_expire_minutes: int = 60

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        valid = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in valid:
            raise ValueError(f"log_level must be one of {valid}")
        return upper

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment == Environment.PRODUCTION


@lru_cache()
def get_settings() -> Settings:
    """Return cached settings singleton."""
    return Settings()
