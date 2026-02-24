"""
Integration tests for the /api/v1/files endpoints.

These tests use the in-memory backend (see conftest.py) – no real storage
backend is required.
"""

import io

import pytest


@pytest.mark.asyncio
async def test_upload_file(async_client):
    content = b"hello integration test"
    response = await async_client.post(
        "/api/v1/files/upload",
        files={"file": ("hello.txt", io.BytesIO(content), "text/plain")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["size"] == len(content)
    assert body["content_type"] == "text/plain"
    assert "key" in body
    assert "url" in body


@pytest.mark.asyncio
async def test_upload_with_custom_key(async_client):
    content = b"custom key content"
    response = await async_client.post(
        "/api/v1/files/upload?key=custom/my-file.txt",
        files={"file": ("my-file.txt", io.BytesIO(content), "text/plain")},
    )
    assert response.status_code == 201
    assert response.json()["key"] == "custom/my-file.txt"


@pytest.mark.asyncio
async def test_download_file(async_client):
    # Upload first
    content = b"download me"
    upload = await async_client.post(
        "/api/v1/files/upload",
        files={"file": ("dl.txt", io.BytesIO(content), "text/plain")},
    )
    key = upload.json()["key"]

    response = await async_client.get(f"/api/v1/files/{key}")
    assert response.status_code == 200
    assert response.content == content


@pytest.mark.asyncio
async def test_download_not_found(async_client):
    response = await async_client.get("/api/v1/files/does-not-exist.txt")
    assert response.status_code == 404
    assert response.json()["error"] == "FILE_NOT_FOUND"


@pytest.mark.asyncio
async def test_stat_file(async_client):
    content = b"stat me"
    upload = await async_client.post(
        "/api/v1/files/upload",
        files={"file": ("stat.txt", io.BytesIO(content), "text/plain")},
    )
    key = upload.json()["key"]

    response = await async_client.get(f"/api/v1/files/{key}/stat")
    assert response.status_code == 200
    body = response.json()
    assert body["size"] == len(content)
    assert body["key"] == key


@pytest.mark.asyncio
async def test_delete_file(async_client):
    content = b"delete me"
    upload = await async_client.post(
        "/api/v1/files/upload",
        files={"file": ("del.txt", io.BytesIO(content), "text/plain")},
    )
    key = upload.json()["key"]

    response = await async_client.delete(f"/api/v1/files/{key}")
    assert response.status_code == 200
    assert response.json()["deleted"] is True

    # Verify it is gone
    get_response = await async_client.get(f"/api/v1/files/{key}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_list_files(async_client):
    # Upload two files under a common prefix
    for i in range(2):
        await async_client.post(
            "/api/v1/files/upload?folder=list-test",
            files={"file": (f"file{i}.txt", io.BytesIO(b"x"), "text/plain")},
        )

    response = await async_client.get("/api/v1/files?prefix=list-test/")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 2


@pytest.mark.asyncio
async def test_presign_url(async_client):
    content = b"presign me"
    upload = await async_client.post(
        "/api/v1/files/upload",
        files={"file": ("ps.txt", io.BytesIO(content), "text/plain")},
    )
    key = upload.json()["key"]

    response = await async_client.post(
        f"/api/v1/files/{key}/presign",
        json={"expires_in": 300, "method": "GET"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in_seconds"] == 300
    assert body["method"] == "GET"
    assert "url" in body
