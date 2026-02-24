"""
Integration tests for the /api/v1/files REST endpoints.
Uses the async_client fixture which wires up an InMemoryStorage backend.
"""
import io
import pytest


@pytest.mark.asyncio
class TestHealthEndpoints:
    async def test_liveness(self, async_client):
        response = await async_client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert "uptime_seconds" in data

    async def test_readiness(self, async_client):
        response = await async_client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["storage_healthy"] is True

    async def test_metrics(self, async_client):
        response = await async_client.get("/metrics")
        assert response.status_code == 200
        assert "uptime_seconds" in response.json()


@pytest.mark.asyncio
class TestFileUpload:
    async def test_upload_returns_201(self, async_client, small_image_bytes):
        response = await async_client.post(
            "/api/v1/files/upload",
            files={"file": ("test.png", io.BytesIO(small_image_bytes), "image/png")},
        )
        assert response.status_code == 201
        data = response.json()
        assert "key" in data
        assert data["content_type"] == "image/png"
        assert data["size_bytes"] == len(small_image_bytes)

    async def test_upload_with_prefix(self, async_client, small_image_bytes):
        response = await async_client.post(
            "/api/v1/files/upload",
            files={"file": ("photo.jpg", io.BytesIO(small_image_bytes), "image/jpeg")},
            data={"prefix": "avatars"},
        )
        assert response.status_code == 201
        key = response.json()["key"]
        assert key.startswith("avatars/")


@pytest.mark.asyncio
class TestFileDownload:
    async def test_download_uploaded_file(self, async_client, small_image_bytes):
        # Upload
        upload_resp = await async_client.post(
            "/api/v1/files/upload",
            files={"file": ("img.png", io.BytesIO(small_image_bytes), "image/png")},
        )
        assert upload_resp.status_code == 201
        key = upload_resp.json()["key"]

        # Download
        download_resp = await async_client.get(f"/api/v1/files/{key}")
        assert download_resp.status_code == 200
        assert download_resp.content == small_image_bytes

    async def test_download_nonexistent_returns_404(self, async_client):
        response = await async_client.get("/api/v1/files/nonexistent/key.png")
        assert response.status_code == 404


@pytest.mark.asyncio
class TestFileList:
    async def test_list_returns_uploaded_files(self, async_client, small_image_bytes):
        # Upload two files
        for name in ("a.png", "b.png"):
            await async_client.post(
                "/api/v1/files/upload",
                files={"file": (name, io.BytesIO(small_image_bytes), "image/png")},
            )

        response = await async_client.get("/api/v1/files")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2
        assert isinstance(data["items"], list)

    async def test_list_with_max_keys(self, async_client, small_image_bytes):
        response = await async_client.get("/api/v1/files?max_keys=1")
        assert response.status_code == 200
        assert len(response.json()["items"]) <= 1


@pytest.mark.asyncio
class TestFileDelete:
    async def test_delete_returns_deleted_true(self, async_client, small_image_bytes):
        upload_resp = await async_client.post(
            "/api/v1/files/upload",
            files={"file": ("del.png", io.BytesIO(small_image_bytes), "image/png")},
        )
        key = upload_resp.json()["key"]

        delete_resp = await async_client.delete(f"/api/v1/files/{key}")
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"] is True

    async def test_delete_nonexistent_returns_404(self, async_client):
        response = await async_client.delete("/api/v1/files/ghost/file.bin")
        assert response.status_code == 404


@pytest.mark.asyncio
class TestPresignedUrls:
    async def test_presigned_download_url(self, async_client, small_image_bytes):
        upload_resp = await async_client.post(
            "/api/v1/files/upload",
            files={"file": ("url_test.png", io.BytesIO(small_image_bytes), "image/png")},
        )
        key = upload_resp.json()["key"]

        url_resp = await async_client.get(f"/api/v1/files/{key}/url")
        assert url_resp.status_code == 200
        data = url_resp.json()
        assert "url" in data
        assert data["key"] == key

    async def test_presigned_upload_url(self, async_client):
        response = await async_client.post(
            "/api/v1/files/upload-url",
            json={
                "filename": "new_image.png",
                "content_type": "image/png",
                "prefix": "uploads",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert "key" in data
        assert data["key"].endswith("new_image.png")
