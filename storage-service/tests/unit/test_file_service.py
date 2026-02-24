"""
Unit tests for FileService.
Uses the InMemoryStorage fixture — no real storage backend required.
"""
import pytest
import pytest_asyncio

from src.core.exceptions import FileTooLargeError, ObjectNotFoundError
from src.services.file_service import FileService


@pytest.mark.asyncio
class TestFileServiceUpload:
    async def test_upload_returns_stored_file(self, file_service, small_image_bytes):
        stored = await file_service.upload_file(
            filename="test.png",
            data=small_image_bytes,
            content_type="image/png",
        )
        assert stored.key.endswith("test.png")
        assert stored.content_type == "image/png"
        assert stored.size_bytes == len(small_image_bytes)
        assert stored.backend == "memory"

    async def test_upload_with_prefix_includes_prefix_in_key(self, file_service, small_image_bytes):
        stored = await file_service.upload_file(
            filename="photo.jpg",
            data=small_image_bytes,
            content_type="image/jpeg",
            prefix="avatars",
        )
        assert stored.key.startswith("avatars/")

    async def test_upload_too_large_raises_error(self, file_service):
        from unittest.mock import patch
        big_data = b"x" * (1024 * 1024 * 10)  # 10 MB

        with patch.object(
            file_service._settings,
            "max_upload_size_bytes",
            new_callable=lambda: property(lambda self: 1024),  # 1 KB limit
        ):
            # Patch directly on the instance
            file_service._settings.__class__.max_upload_size_bytes = property(lambda s: 1024)
            with pytest.raises(FileTooLargeError):
                await file_service.upload_file(
                    filename="big.bin",
                    data=big_data,
                )

    async def test_upload_guesses_content_type_from_filename(self, file_service, small_image_bytes):
        stored = await file_service.upload_file(
            filename="image.png",
            data=small_image_bytes,
        )
        assert stored.content_type == "image/png"


@pytest.mark.asyncio
class TestFileServiceDownload:
    async def test_download_returns_uploaded_bytes(self, file_service, small_image_bytes):
        stored = await file_service.upload_file(
            filename="test.png",
            data=small_image_bytes,
        )
        downloaded = await file_service.download_file(stored.key)
        assert downloaded == small_image_bytes

    async def test_download_missing_key_raises_not_found(self, file_service):
        with pytest.raises(ObjectNotFoundError):
            await file_service.download_file("nonexistent/key.png")


@pytest.mark.asyncio
class TestFileServiceDelete:
    async def test_delete_removes_file(self, file_service, small_image_bytes):
        stored = await file_service.upload_file(filename="del.png", data=small_image_bytes)
        await file_service.delete_file(stored.key)

        with pytest.raises(ObjectNotFoundError):
            await file_service.download_file(stored.key)

    async def test_delete_missing_key_raises_not_found(self, file_service):
        with pytest.raises(ObjectNotFoundError):
            await file_service.delete_file("does/not/exist.png")


@pytest.mark.asyncio
class TestFileServiceList:
    async def test_list_returns_uploaded_files(self, file_service, small_image_bytes):
        await file_service.upload_file(filename="a.png", data=small_image_bytes, prefix="images")
        await file_service.upload_file(filename="b.png", data=small_image_bytes, prefix="images")

        files, next_token = await file_service.list_files(prefix="images")
        assert len(files) >= 2
        assert next_token is None

    async def test_list_prefix_filters_results(self, file_service, small_image_bytes):
        await file_service.upload_file(filename="c.png", data=small_image_bytes, prefix="cats")
        await file_service.upload_file(filename="d.png", data=small_image_bytes, prefix="dogs")

        cats, _ = await file_service.list_files(prefix="cats")
        dogs, _ = await file_service.list_files(prefix="dogs")

        assert all(f.key.startswith("cats") for f in cats)
        assert all(f.key.startswith("dogs") for f in dogs)


@pytest.mark.asyncio
class TestFileServicePresignedUrls:
    async def test_presigned_download_url_contains_key(self, file_service, small_image_bytes):
        stored = await file_service.upload_file(filename="url.png", data=small_image_bytes)
        url = await file_service.get_download_url(stored.key)
        assert stored.key in url

    async def test_presigned_upload_url_has_url_and_key(self, file_service):
        result = await file_service.get_upload_url(
            filename="new.png", content_type="image/png"
        )
        assert "url" in result
        assert "key" in result
        assert result["key"].endswith("new.png")
