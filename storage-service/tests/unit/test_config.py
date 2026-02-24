"""Unit tests for application configuration."""

import pytest
from pydantic import ValidationError

from src.core.config import Environment, Settings, StorageBackend


def test_defaults():
    """Default settings should be valid and safe for development."""
    s = Settings()
    assert s.environment == Environment.development
    assert s.storage_backend == StorageBackend.minio
    assert s.log_level == "INFO"


def test_max_upload_size_bytes():
    s = Settings(max_upload_size_mb=10)
    assert s.max_upload_size_bytes == 10 * 1024 * 1024


def test_is_production_flag():
    s = Settings(environment="production")
    assert s.is_production is True

    s_dev = Settings(environment="development")
    assert s_dev.is_production is False


def test_invalid_log_level():
    with pytest.raises(ValidationError):
        Settings(log_level="VERBOSE")


def test_invalid_environment():
    with pytest.raises(ValidationError):
        Settings(environment="unknown")
