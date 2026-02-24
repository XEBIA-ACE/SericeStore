"""
Unit tests for storage base utilities.
"""
import pytest

from src.core.exceptions import InvalidKeyError
from src.infrastructure.storage.base import (
    chunk_bytes,
    compute_md5,
    guess_content_type,
    sanitize_key,
)


class TestSanitizeKey:
    def test_simple_key_unchanged(self):
        assert sanitize_key("images/photo.jpg") == "images/photo.jpg"

    def test_replaces_spaces(self):
        result = sanitize_key("my image.jpg")
        assert " " not in result

    def test_strips_leading_slashes(self):
        assert not sanitize_key("/images/photo.jpg").startswith("/")

    def test_collapses_double_slashes(self):
        result = sanitize_key("images//nested//file.png")
        assert "//" not in result

    def test_empty_key_raises(self):
        with pytest.raises(InvalidKeyError):
            sanitize_key("")

    def test_key_too_long_raises(self):
        with pytest.raises(InvalidKeyError):
            sanitize_key("a" * 1025)


class TestGuessContentType:
    def test_jpg(self):
        assert guess_content_type("photo.jpg") == "image/jpeg"

    def test_png(self):
        assert guess_content_type("img.png") == "image/png"

    def test_mp4(self):
        assert guess_content_type("video.mp4") == "video/mp4"

    def test_unknown_falls_back_to_octet_stream(self):
        assert guess_content_type("unknown.xyz") == "application/octet-stream"

    def test_custom_fallback(self):
        assert guess_content_type("x.zzz", fallback="text/plain") == "text/plain"


class TestComputeMd5:
    def test_known_hash(self):
        # echo -n "hello" | md5sum
        result = compute_md5(b"hello")
        assert result == "5d41402abc4b2a76b9719d911017c592"

    def test_empty_bytes(self):
        result = compute_md5(b"")
        assert result == "d41d8cd98f00b204e9800998ecf8427e"


class TestChunkBytes:
    def test_evenly_divisible(self):
        data = b"x" * 10
        chunks = list(chunk_bytes(data, chunk_size=5))
        assert chunks == [b"xxxxx", b"xxxxx"]

    def test_remainder_chunk(self):
        data = b"x" * 13
        chunks = list(chunk_bytes(data, chunk_size=5))
        assert len(chunks) == 3
        assert len(chunks[-1]) == 3

    def test_single_chunk_smaller_than_size(self):
        data = b"abc"
        chunks = list(chunk_bytes(data, chunk_size=100))
        assert chunks == [b"abc"]
