"""
Application configuration using Pydantic Settings.

Reads from environment variables with support for .env files.
All secrets must be supplied via environment; defaults are safe for development only.
"""

from enum import Enum
from functools import lru_cache
from typing import Optional

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    development = "development"
    staging = "staging"
    production = "production"


class StorageBackend(str, Enum):
    s3 = "s3"
    gcs = "gcs"
    minio = "minio"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────────
    app_name: str = "Storage Service"
    app_version: str = "1.0.0"
    environment: Environment = Environment.development
    debug: bool = False
    secret_key: str = Field(default="change-me-in-production", min_length=16)

    # ── Server ───────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 1
    reload: bool = False

    # ── Storage ───────────────────────────────────────────────────────────────
    storage_backend: StorageBackend = StorageBackend.minio
    max_upload_size_mb: int = 500  # per-file limit in megabytes

    # ── Amazon S3 ────────────────────────────────────────────────────────────
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_region: str = "us-east-1"
    s3_bucket: Optional[str] = None
    s3_endpoint_url: Optional[AnyHttpUrl] = None  # for localstack / custom

    # ── Google Cloud Storage ─────────────────────────────────────────────────
    gcs_bucket: Optional[str] = None
    gcs_credentials_json: Optional[str] = None  # path to service-account JSON
    gcs_project_id: Optional[str] = None

    # ── MinIO ────────────────────────────────────────────────────────────────
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "storage-service"
    minio_secure: bool = False

    # ── Image Processing ─────────────────────────────────────────────────────
    imagemagick_binary: str = "convert"
    image_max_width: int = 4096
    image_max_height: int = 4096
    image_thumbnail_width: int = 256
    image_thumbnail_height: int = 256
    image_quality: int = 85

    # ── Video Processing ──────────────────────────────────────────────────────
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    video_max_duration_seconds: int = 3600  # 1 hour
    video_thumbnail_time_offset: str = "00:00:05"  # snapshot at 5 s

    # ── Logging ───────────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_format: str = "json"  # "json" | "text"

    # ── CORS ─────────────────────────────────────────────────────────────────
    cors_origins: list[str] = ["*"]
    cors_allow_credentials: bool = True

    # ── Auth (placeholder – wire your IdP here) ───────────────────────────────
    auth_enabled: bool = False
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in allowed:
            raise ValueError(f"log_level must be one of {allowed}")
        return upper

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment == Environment.production


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings singleton."""
    return Settings()
