"""
Shared helpers for all storage backend implementations.
"""
import hashlib
import mimetypes
import os
import re
import unicodedata
from pathlib import Path

from src.core.exceptions import InvalidKeyError


_FORBIDDEN_KEY_PATTERN = re.compile(r"[^\w\-./]")
_DOUBLE_SLASH = re.compile(r"/{2,}")


def sanitize_key(key: str) -> str:
    """
    Sanitize an object key so it is safe for all storage backends.

    Rules:
    - Normalize unicode to NFC
    - Replace non-alphanumeric chars (except - . /) with underscores
    - Collapse multiple slashes
    - Strip leading/trailing slashes
    - Raise InvalidKeyError if the result is empty or too long
    """
    key = unicodedata.normalize("NFC", key)
    key = _FORBIDDEN_KEY_PATTERN.sub("_", key)
    key = _DOUBLE_SLASH.sub("/", key)
    key = key.strip("/")

    if not key:
        raise InvalidKeyError("Object key cannot be empty after sanitization")
    if len(key) > 1024:
        raise InvalidKeyError(f"Object key exceeds 1024 characters: {len(key)}")

    return key


def guess_content_type(filename: str, fallback: str = "application/octet-stream") -> str:
    """Return MIME type for a filename, falling back to ``fallback``."""
    mime, _ = mimetypes.guess_type(filename)
    return mime or fallback


def compute_md5(data: bytes) -> str:
    """Return the hex MD5 digest of ``data``."""
    return hashlib.md5(data).hexdigest()


def ensure_temp_dir(path: str) -> Path:
    """Create the temp directory if it doesn't exist and return it as a Path."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def chunk_bytes(data: bytes, chunk_size: int = 8 * 1024 * 1024):
    """Yield successive chunks of ``data`` of at most ``chunk_size`` bytes."""
    for i in range(0, len(data), chunk_size):
        yield data[i : i + chunk_size]
