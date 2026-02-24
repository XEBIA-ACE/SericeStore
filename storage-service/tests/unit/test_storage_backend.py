"""Unit tests for the in-memory storage backend (used as a reference implementation)."""

import pytest

from src.core.exceptions import FileNotFoundError
from tests.conftest import InMemoryStorageBackend


@pytest.mark.asyncio
async def test_upload_and_download():
    backend = InMemoryStorageBackend()
    data = b"hello world"
    meta = await backend.upload("test/hello.txt", data, "text/plain")

    assert meta.key == "test/hello.txt"
    assert meta.size == len(data)
    assert meta.content_type == "text/plain"

    downloaded = await backend.download("test/hello.txt")
    assert downloaded == data


@pytest.mark.asyncio
async def test_download_missing_raises():
    backend = InMemoryStorageBackend()
    with pytest.raises(FileNotFoundError):
        await backend.download("does-not-exist.txt")


@pytest.mark.asyncio
async def test_delete():
    backend = InMemoryStorageBackend()
    await backend.upload("del.txt", b"bye", "text/plain")
    await backend.delete("del.txt")
    assert not await backend.exists("del.txt")


@pytest.mark.asyncio
async def test_delete_missing_raises():
    backend = InMemoryStorageBackend()
    with pytest.raises(FileNotFoundError):
        await backend.delete("ghost.txt")


@pytest.mark.asyncio
async def test_exists():
    backend = InMemoryStorageBackend()
    assert not await backend.exists("nope.txt")
    await backend.upload("yes.txt", b"x", "text/plain")
    assert await backend.exists("yes.txt")


@pytest.mark.asyncio
async def test_list_objects_prefix_filter():
    backend = InMemoryStorageBackend()
    await backend.upload("images/a.png", b"a", "image/png")
    await backend.upload("images/b.png", b"b", "image/png")
    await backend.upload("videos/c.mp4", b"c", "video/mp4")

    images = await backend.list_objects(prefix="images/")
    assert len(images) == 2
    keys = {o.key for o in images}
    assert "images/a.png" in keys
    assert "images/b.png" in keys


@pytest.mark.asyncio
async def test_presign():
    backend = InMemoryStorageBackend()
    result = await backend.generate_presigned_url("my/file.txt", expires_in=600, method="GET")
    assert result.expires_in_seconds == 600
    assert result.method == "GET"
    assert "fake" in result.url


@pytest.mark.asyncio
async def test_stat():
    backend = InMemoryStorageBackend()
    await backend.upload("meta.txt", b"abc", "text/plain")
    meta = await backend.stat("meta.txt")
    assert meta.size == 3
    assert meta.content_type == "text/plain"


@pytest.mark.asyncio
async def test_download_stream():
    backend = InMemoryStorageBackend()
    payload = b"streaming data"
    await backend.upload("stream.txt", payload, "text/plain")

    chunks = []
    async for chunk in backend.download_stream("stream.txt"):
        chunks.append(chunk)

    assert b"".join(chunks) == payload
