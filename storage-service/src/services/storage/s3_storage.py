"""
Amazon S3 storage backend.

Uses aiobotocore (async wrapper around botocore) so all I/O is non-blocking.
"""

import io
from typing import AsyncIterator, Optional

import aiobotocore.session
from botocore.exceptions import ClientError

from src.core.config import Settings
from src.core.exceptions import (
    FileNotFoundError,
    StorageBackendError,
)
from src.core.logging import get_logger
from src.services.storage.base import BaseStorageBackend, ObjectMetadata, PresignedUrlResult

logger = get_logger(__name__)


class S3StorageBackend(BaseStorageBackend):
    """AWS S3 (and S3-compatible) storage backend via aiobotocore."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._bucket = settings.s3_bucket
        self._session = aiobotocore.session.get_session()
        self._client_kwargs: dict = {
            "region_name": settings.aws_region,
        }
        if settings.aws_access_key_id:
            self._client_kwargs["aws_access_key_id"] = settings.aws_access_key_id
        if settings.aws_secret_access_key:
            self._client_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.s3_endpoint_url:
            self._client_kwargs["endpoint_url"] = str(settings.s3_endpoint_url)

    def _client(self):
        """Return an async context-manager-based S3 client."""
        return self._session.create_client("s3", **self._client_kwargs)

    async def ensure_bucket(self) -> None:
        async with self._client() as client:
            try:
                await client.head_bucket(Bucket=self._bucket)
                logger.info("s3.bucket_exists", bucket=self._bucket)
            except ClientError as exc:
                code = exc.response["Error"]["Code"]
                if code in ("404", "NoSuchBucket"):
                    region = self._settings.aws_region
                    create_kwargs: dict = {"Bucket": self._bucket}
                    # us-east-1 does not accept a LocationConstraint
                    if region != "us-east-1":
                        create_kwargs["CreateBucketConfiguration"] = {
                            "LocationConstraint": region
                        }
                    await client.create_bucket(**create_kwargs)
                    logger.info("s3.bucket_created", bucket=self._bucket)
                else:
                    raise StorageBackendError(f"S3 bucket check failed: {exc}") from exc

    async def upload(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[dict] = None,
    ) -> ObjectMetadata:
        extra: dict = {"ContentType": content_type}
        if metadata:
            extra["Metadata"] = {k: str(v) for k, v in metadata.items()}

        async with self._client() as client:
            try:
                response = await client.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=data,
                    **extra,
                )
            except ClientError as exc:
                raise StorageBackendError(f"S3 upload failed for {key}: {exc}") from exc

        etag = response.get("ETag", "").strip('"')
        url = f"https://{self._bucket}.s3.amazonaws.com/{key}"
        logger.info("s3.upload_ok", key=key, size=len(data), etag=etag)
        return ObjectMetadata(
            key=key,
            bucket=self._bucket,
            size=len(data),
            content_type=content_type,
            etag=etag,
            url=url,
        )

    async def download(self, key: str) -> bytes:
        async with self._client() as client:
            try:
                response = await client.get_object(Bucket=self._bucket, Key=key)
                body = await response["Body"].read()
            except ClientError as exc:
                code = exc.response["Error"]["Code"]
                if code in ("NoSuchKey", "404"):
                    raise FileNotFoundError(f"Object not found: {key}") from exc
                raise StorageBackendError(f"S3 download failed for {key}: {exc}") from exc

        logger.info("s3.download_ok", key=key, size=len(body))
        return body

    async def download_stream(self, key: str) -> AsyncIterator[bytes]:
        async with self._client() as client:
            try:
                response = await client.get_object(Bucket=self._bucket, Key=key)
                async for chunk in response["Body"].iter_chunks(chunk_size=65536):
                    yield chunk
            except ClientError as exc:
                code = exc.response["Error"]["Code"]
                if code in ("NoSuchKey", "404"):
                    raise FileNotFoundError(f"Object not found: {key}") from exc
                raise StorageBackendError(f"S3 stream failed for {key}: {exc}") from exc

    async def delete(self, key: str) -> None:
        async with self._client() as client:
            try:
                await client.delete_object(Bucket=self._bucket, Key=key)
            except ClientError as exc:
                raise StorageBackendError(f"S3 delete failed for {key}: {exc}") from exc
        logger.info("s3.delete_ok", key=key)

    async def exists(self, key: str) -> bool:
        async with self._client() as client:
            try:
                await client.head_object(Bucket=self._bucket, Key=key)
                return True
            except ClientError as exc:
                if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
                    return False
                raise StorageBackendError(f"S3 exists check failed for {key}: {exc}") from exc

    async def stat(self, key: str) -> ObjectMetadata:
        async with self._client() as client:
            try:
                response = await client.head_object(Bucket=self._bucket, Key=key)
            except ClientError as exc:
                code = exc.response["Error"]["Code"]
                if code in ("404", "NoSuchKey"):
                    raise FileNotFoundError(f"Object not found: {key}") from exc
                raise StorageBackendError(f"S3 stat failed for {key}: {exc}") from exc

        return ObjectMetadata(
            key=key,
            bucket=self._bucket,
            size=response.get("ContentLength", 0),
            content_type=response.get("ContentType", "application/octet-stream"),
            etag=response.get("ETag", "").strip('"'),
            url=f"https://{self._bucket}.s3.amazonaws.com/{key}",
        )

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
    ) -> list[ObjectMetadata]:
        async with self._client() as client:
            try:
                response = await client.list_objects_v2(
                    Bucket=self._bucket,
                    Prefix=prefix,
                    MaxKeys=max_keys,
                )
            except ClientError as exc:
                raise StorageBackendError(f"S3 list failed: {exc}") from exc

        results = []
        for obj in response.get("Contents", []):
            results.append(
                ObjectMetadata(
                    key=obj["Key"],
                    bucket=self._bucket,
                    size=obj.get("Size", 0),
                    content_type="",
                    etag=obj.get("ETag", "").strip('"'),
                    url=f"https://{self._bucket}.s3.amazonaws.com/{obj['Key']}",
                )
            )
        return results

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        method: str = "GET",
    ) -> PresignedUrlResult:
        operation = "get_object" if method.upper() == "GET" else "put_object"
        async with self._client() as client:
            try:
                url = await client.generate_presigned_url(
                    ClientMethod=operation,
                    Params={"Bucket": self._bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            except ClientError as exc:
                raise StorageBackendError(
                    f"S3 presign failed for {key}: {exc}"
                ) from exc

        return PresignedUrlResult(url=url, expires_in_seconds=expires_in, method=method)
