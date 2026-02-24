"""
Shared pytest fixtures for unit and integration tests.
"""
import io
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from src.domain.models.file import StoredFile
from src.domain.repositories.storage_repository import StorageRepository


# ---------------------------------------------------------------------------
# Fake storage backend — in-memory, used by unit tests
# ---------------------------------------------------------------------------

class InMemoryStorage(StorageRepository):
    """Minimal in-memory storage backend for tests."""

    def __init__(self):
        self._objects: dict[str, tuple[bytes, str, dict]] = {}

    async def upload(self, key, data, content_type, metadata=None):
        self._objects[key] = (data, content_type, metadata or {})
        return StoredFile(
            key=key,
            bucket="test-bucket",
            backend="memory",
            content_type=content_type,
            size_bytes=len(data),
            etag="test-etag",
            metadata=metadata or {},
        )

    async def upload_stream(self, key, stream, content_type, size_hint=None, metadata=None):
        chunks = []
        async for chunk in stream:
            chunks.append(chunk)
        return await self.upload(key, b"".join(chunks), content_type, metadata)

    async def download(self, key):
        if key not in self._objects:
            from src.core.exceptions import ObjectNotFoundError
            raise ObjectNotFoundError(f"Object not found: {key}")
        return self._objects[key][0]

    async def download_stream(self, key):
        data = await self.download(key)
        yield data

    async def delete(self, key):
        self._objects.pop(key, None)

    async def exists(self, key):
        return key in self._objects

    async def get_metadata(self, key):
        if key not in self._objects:
            from src.core.exceptions import ObjectNotFoundError
            raise ObjectNotFoundError(f"Object not found: {key}")
        data, ct, meta = self._objects[key]
        return StoredFile(
            key=key,
            bucket="test-bucket",
            backend="memory",
            content_type=ct,
            size_bytes=len(data),
            metadata=meta,
        )

    async def list_objects(self, prefix="", max_keys=1000, continuation_token=None):
        items = [
            StoredFile(
                key=k,
                bucket="test-bucket",
                backend="memory",
                content_type=ct,
                size_bytes=len(data),
            )
            for k, (data, ct, _) in self._objects.items()
            if k.startswith(prefix)
        ][:max_keys]
        return items, None

    async def generate_presigned_download_url(self, key, expires_in=3600):
        return f"http://localhost/presigned/download/{key}?expires={expires_in}"

    async def generate_presigned_upload_url(self, key, content_type, expires_in=3600, max_size_bytes=None):
        return {
            "url": f"http://localhost/presigned/upload/{key}",
            "fields": {"Content-Type": content_type},
        }

    async def ensure_bucket_exists(self):
        pass

    async def health_check(self):
        return True


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def in_memory_storage() -> InMemoryStorage:
    return InMemoryStorage()


@pytest.fixture
def file_service(in_memory_storage):
    from src.services.file_service import FileService
    return FileService(storage=in_memory_storage)


@pytest.fixture
def small_image_bytes() -> bytes:
    """Return a minimal valid 1×1 PNG as test image data."""
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd4n\x00\x00\x00\x00IEND\xaeB`\x82"
    )


@pytest_asyncio.fixture
async def async_client():
    """Async HTTP client for FastAPI integration tests."""
    # Override the storage backend with the in-memory implementation
    from main import app
    from src.infrastructure.storage import get_storage_backend

    storage = InMemoryStorage()
    app.dependency_overrides[get_storage_backend] = lambda: storage

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
