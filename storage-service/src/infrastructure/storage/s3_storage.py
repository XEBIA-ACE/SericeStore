"""
Amazon S3 storage backend implementation.
Uses aioboto3 for async access.
"""
import io
from datetime import datetime
from typing import AsyncIterator, Optional

import aioboto3
from botocore.exceptions import ClientError

from src.core.config import get_settings
from src.core.exceptions import (
    BucketNotFoundError,
    ObjectNotFoundError,
    PresignedUrlError,
    StorageBackendUnavailableError,
    StorageError,
)
from src.core.logging import get_logger
from src.domain.models.file import StoredFile
from src.domain.repositories.storage_repository import StorageRepository
from src.infrastructure.storage.base import compute_md5, sanitize_key

logger = get_logger(__name__)


class S3Storage(StorageRepository):
    """Async S3 storage adapter using aioboto3."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._bucket = self._settings.aws_s3_bucket
        self._session = aioboto3.Session(
            aws_access_key_id=self._settings.aws_access_key_id,
            aws_secret_access_key=self._settings.aws_secret_access_key,
            region_name=self._settings.aws_region,
        )
        self._client_kwargs: dict = {}
        if self._settings.aws_s3_endpoint_url:
            self._client_kwargs["endpoint_url"] = self._settings.aws_s3_endpoint_url

    def _client(self):
        """Return an async context manager yielding an S3 client."""
        return self._session.client("s3", **self._client_kwargs)

    def _resource(self):
        """Return an async context manager yielding an S3 resource."""
        return self._session.resource("s3", **self._client_kwargs)

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        key = sanitize_key(key)
        extra_args: dict = {"ContentType": content_type}
        if metadata:
            # S3 metadata values must be strings
            extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}

        try:
            async with self._client() as client:
                response = await client.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=data,
                    **extra_args,
                )
            etag = response.get("ETag", "").strip('"')
            logger.info("s3_upload_success", key=key, size=len(data), etag=etag)
            return StoredFile(
                key=key,
                bucket=self._bucket,
                backend="s3",
                content_type=content_type,
                size_bytes=len(data),
                etag=etag,
                metadata=metadata or {},
            )
        except ClientError as exc:
            logger.error("s3_upload_failed", key=key, error=str(exc))
            raise StorageError(f"S3 upload failed for key '{key}': {exc}") from exc

    async def upload_stream(
        self,
        key: str,
        stream: AsyncIterator[bytes],
        content_type: str,
        size_hint: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> StoredFile:
        """Multipart upload for large streaming payloads."""
        key = sanitize_key(key)
        extra_args: dict = {"ContentType": content_type}
        if metadata:
            extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}

        try:
            async with self._client() as client:
                # Initiate multipart
                mp = await client.create_multipart_upload(
                    Bucket=self._bucket, Key=key, **extra_args
                )
                upload_id = mp["UploadId"]
                parts = []
                part_number = 1
                total_bytes = 0
                buffer = bytearray()
                min_part_size = 5 * 1024 * 1024  # 5 MiB minimum per AWS spec

                async for chunk in stream:
                    buffer.extend(chunk)
                    while len(buffer) >= min_part_size:
                        part_data = bytes(buffer[:min_part_size])
                        buffer = buffer[min_part_size:]
                        response = await client.upload_part(
                            Bucket=self._bucket,
                            Key=key,
                            UploadId=upload_id,
                            PartNumber=part_number,
                            Body=part_data,
                        )
                        parts.append({"PartNumber": part_number, "ETag": response["ETag"]})
                        total_bytes += len(part_data)
                        part_number += 1

                # Upload remaining buffer as the last part
                if buffer:
                    response = await client.upload_part(
                        Bucket=self._bucket,
                        Key=key,
                        UploadId=upload_id,
                        PartNumber=part_number,
                        Body=bytes(buffer),
                    )
                    parts.append({"PartNumber": part_number, "ETag": response["ETag"]})
                    total_bytes += len(buffer)

                result = await client.complete_multipart_upload(
                    Bucket=self._bucket,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": parts},
                )

            etag = result.get("ETag", "").strip('"')
            logger.info("s3_multipart_upload_success", key=key, size=total_bytes)
            return StoredFile(
                key=key,
                bucket=self._bucket,
                backend="s3",
                content_type=content_type,
                size_bytes=total_bytes,
                etag=etag,
                metadata=metadata or {},
            )
        except ClientError as exc:
            logger.error("s3_multipart_upload_failed", key=key, error=str(exc))
            raise StorageError(f"S3 multipart upload failed for key '{key}': {exc}") from exc

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    async def download(self, key: str) -> bytes:
        key = sanitize_key(key)
        try:
            async with self._client() as client:
                response = await client.get_object(Bucket=self._bucket, Key=key)
                body = await response["Body"].read()
            logger.info("s3_download_success", key=key, size=len(body))
            return body
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "404"):
                raise ObjectNotFoundError(f"Object not found: {key}") from exc
            raise StorageError(f"S3 download failed for key '{key}': {exc}") from exc

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        key = sanitize_key(key)
        try:
            async with self._client() as client:
                response = await client.get_object(Bucket=self._bucket, Key=key)
                async for chunk in response["Body"].iter_chunks(chunk_size=1024 * 1024):
                    yield chunk
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "404"):
                raise ObjectNotFoundError(f"Object not found: {key}") from exc
            raise StorageError(f"S3 stream failed for key '{key}': {exc}") from exc

    # ------------------------------------------------------------------
    # Delete / Exists / Metadata
    # ------------------------------------------------------------------

    async def delete(self, key: str) -> None:
        key = sanitize_key(key)
        try:
            async with self._client() as client:
                await client.delete_object(Bucket=self._bucket, Key=key)
            logger.info("s3_delete_success", key=key)
        except ClientError as exc:
            raise StorageError(f"S3 delete failed for key '{key}': {exc}") from exc

    async def exists(self, key: str) -> bool:
        key = sanitize_key(key)
        try:
            async with self._client() as client:
                await client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            raise StorageError(f"S3 head_object failed: {exc}") from exc

    async def get_metadata(self, key: str) -> StoredFile:
        key = sanitize_key(key)
        try:
            async with self._client() as client:
                response = await client.head_object(Bucket=self._bucket, Key=key)
            return StoredFile(
                key=key,
                bucket=self._bucket,
                backend="s3",
                content_type=response.get("ContentType", "application/octet-stream"),
                size_bytes=response.get("ContentLength", 0),
                etag=response.get("ETag", "").strip('"'),
                metadata=response.get("Metadata", {}),
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
                raise ObjectNotFoundError(f"Object not found: {key}") from exc
            raise StorageError(f"S3 metadata fetch failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StoredFile], Optional[str]]:
        kwargs: dict = {
            "Bucket": self._bucket,
            "Prefix": prefix,
            "MaxKeys": min(max_keys, 1000),
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        try:
            async with self._client() as client:
                response = await client.list_objects_v2(**kwargs)

            files = [
                StoredFile(
                    key=obj["Key"],
                    bucket=self._bucket,
                    backend="s3",
                    content_type="application/octet-stream",
                    size_bytes=obj.get("Size", 0),
                    etag=obj.get("ETag", "").strip('"'),
                )
                for obj in response.get("Contents", [])
            ]
            next_token = response.get("NextContinuationToken")
            return files, next_token
        except ClientError as exc:
            raise StorageError(f"S3 list failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Presigned URLs
    # ------------------------------------------------------------------

    async def generate_presigned_download_url(
        self, key: str, expires_in: int = 3600
    ) -> str:
        key = sanitize_key(key)
        try:
            async with self._client() as client:
                url = await client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self._bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            return url
        except ClientError as exc:
            raise PresignedUrlError(f"Failed to generate presigned download URL: {exc}") from exc

    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        max_size_bytes: Optional[int] = None,
    ) -> dict:
        key = sanitize_key(key)
        conditions = [{"Content-Type": content_type}]
        fields = {"Content-Type": content_type}
        if max_size_bytes:
            conditions.append(["content-length-range", 1, max_size_bytes])

        try:
            async with self._client() as client:
                result = await client.generate_presigned_post(
                    self._bucket,
                    key,
                    Fields=fields,
                    Conditions=conditions,
                    ExpiresIn=expires_in,
                )
            return result
        except ClientError as exc:
            raise PresignedUrlError(f"Failed to generate presigned upload URL: {exc}") from exc

    # ------------------------------------------------------------------
    # Bucket management
    # ------------------------------------------------------------------

    async def ensure_bucket_exists(self) -> None:
        try:
            async with self._client() as client:
                try:
                    await client.head_bucket(Bucket=self._bucket)
                except ClientError as exc:
                    if exc.response["Error"]["Code"] == "404":
                        kwargs: dict = {"Bucket": self._bucket}
                        if self._settings.aws_region != "us-east-1":
                            kwargs["CreateBucketConfiguration"] = {
                                "LocationConstraint": self._settings.aws_region
                            }
                        await client.create_bucket(**kwargs)
                        logger.info("s3_bucket_created", bucket=self._bucket)
                    else:
                        raise
        except ClientError as exc:
            raise StorageBackendUnavailableError(f"S3 bucket operation failed: {exc}") from exc

    async def health_check(self) -> bool:
        try:
            async with self._client() as client:
                await client.head_bucket(Bucket=self._bucket)
            return True
        except Exception:
            return False
