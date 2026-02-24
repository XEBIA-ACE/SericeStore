"""
Shared pytest fixtures.

The conftest is arranged in layers:
  1. Settings overrides       – lightweight, no I/O
  2. Storage mocks            – in-memory fake backend
  3. FastAPI test client      – async httpx client
"""

import asyncio
from typing import AsyncIterator, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.core.config import Settings, StorageBackend
from src.main import create_app
from src.services.storage.base import BaseStorageBackend, ObjectMetadata, PresignedUrlResult


# ── Event loop ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def event_loop():
    """Use a single event loop for the entire test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── Settings ──────────────────────────────────────────────────────────────────

@pytest.fixture
def test_settings() -> Settings:
    """Minimal settings for unit testing (no real backends needed)."""
    return Settings(
        environment="development",
        debug=True,
        storage_backend=StorageBackend.minio,
        minio_endpoint="localhost:9000",
        minio_access_key="test",
        minio_secret_key="test",
        minio_bucket="test-bucket",
        log_level="WARNING",
        auth_enabled=False,
    )


# ── In-memory storage fake ────────────────────────────────────────────────────

class InMemoryStorageBackend(BaseStorageBackend):
    """
    Fully in-memory storage backend used in unit / integration tests.

    No network calls; all data lives in a dict.
    """

    def __init__(self):
        self._store: dict[str, tuple[bytes, str]] = {}  # key → (data, content_type)

    async def ensure_bucket(self) -> None:
        pass

    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> ObjectMetadata:
        self._store[key] = (data, content_type)
        return ObjectMetadata(
            key=key,
            bucket="test-bucket",
            size=len(data),
            content_type=content_type,
            etag="test-etag",
            url=f"http://localhost:9000/test-bucket/{key}",
        )

    async def download(self, key: str) -> bytes:
        if key not in self._store:
            from src.core.exceptions import FileNotFoundError
            raise FileNotFoundError(f"Object not found: {key}")
        return self._store[key][0]

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        data = await self.download(key)
        yield data

    async def delete(self, key: str) -> None:
        if key not in self._store:
            from src.core.exceptions import FileNotFoundError
            raise FileNotFoundError(f"Object not found: {key}")
        del self._store[key]

    async def exists(self, key: str) -> bool:
        return key in self._store

    async def stat(self, key: str) -> ObjectMetadata:
        if key not in self._store:
            from src.core.exceptions import FileNotFoundError
            raise FileNotFoundError(f"Object not found: {key}")
        data, ct = self._store[key]
        return ObjectMetadata(
            key=key,
            bucket="test-bucket",
            size=len(data),
            content_type=ct,
            etag="test-etag",
            url=f"http://localhost:9000/test-bucket/{key}",
        )

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
    ) -> list[ObjectMetadata]:
        results = []
        for key, (data, ct) in self._store.items():
            if key.startswith(prefix):
                results.append(
                    ObjectMetadata(
                        key=key,
                        bucket="test-bucket",
                        size=len(data),
                        content_type=ct,
                        etag="test-etag",
                        url=f"http://localhost:9000/test-bucket/{key}",
                    )
                )
            if len(results) >= max_keys:
                break
        return results

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        method: str = "GET",
    ) -> PresignedUrlResult:
        url = f"http://localhost:9000/test-bucket/{key}?token=fake"
        return PresignedUrlResult(url=url, expires_in_seconds=expires_in, method=method)


@pytest.fixture
def memory_storage() -> InMemoryStorageBackend:
    return InMemoryStorageBackend()


# ── FastAPI test client ────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def async_client(memory_storage: InMemoryStorageBackend) -> AsyncIterator[AsyncClient]:
    """
    Async HTTPX client wired to the FastAPI app with the in-memory backend.

    Storage dependency is overridden so no real backend is needed.
    """
    from src.api.v1.dependencies import get_storage
    from src.core.config import get_settings

    app = create_app()
    app.dependency_overrides[get_storage] = lambda: memory_storage
    app.dependency_overrides[get_settings] = lambda: Settings(
        storage_backend=StorageBackend.minio,
        auth_enabled=False,
        log_level="WARNING",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
