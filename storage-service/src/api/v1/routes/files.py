"""
File (object) CRUD endpoints.

POST   /files/upload          – upload a file
GET    /files/{key}           – download a file
DELETE /files/{key}           – delete a file
GET    /files/{key}/stat      – object metadata
GET    /files/{key}/presign   – generate a pre-signed URL
GET    /files                 – list objects (optional prefix filter)
"""

import mimetypes
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from src.api.v1.dependencies import SettingsDep, StorageDep
from src.core.exceptions import (
    FileNotFoundError,
    FileTooLargeError,
    StorageBackendError,
)
from src.core.logging import get_logger
from src.models.schemas import (
    DeleteResponse,
    ListObjectsResponse,
    ObjectMetadataResponse,
    PresignRequest,
    PresignedUrlResponse,
)

router = APIRouter(prefix="/files", tags=["Files"])
logger = get_logger(__name__)


def _meta_to_response(meta) -> ObjectMetadataResponse:
    return ObjectMetadataResponse(
        key=meta.key,
        bucket=meta.bucket,
        size=meta.size,
        content_type=meta.content_type,
        etag=meta.etag,
        url=meta.url,
        extra=meta.extra,
    )


@router.post(
    "/upload",
    response_model=ObjectMetadataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a file",
    description=(
        "Upload any file to the configured storage backend. "
        "The object key is auto-generated (UUID) unless you supply one via "
        "the `key` query parameter."
    ),
)
async def upload_file(
    storage: StorageDep,
    settings: SettingsDep,
    file: UploadFile = File(...),
    key: Optional[str] = Query(default=None, description="Custom object key"),
    folder: Optional[str] = Query(default=None, description="Prefix / folder path"),
) -> ObjectMetadataResponse:
    data = await file.read()

    if len(data) > settings.max_upload_size_bytes:
        raise FileTooLargeError(
            f"File size {len(data)} exceeds limit {settings.max_upload_size_bytes} bytes"
        )

    content_type = file.content_type or "application/octet-stream"
    ext = mimetypes.guess_extension(content_type) or ""

    if key is None:
        object_key = f"{uuid.uuid4().hex}{ext}"
    else:
        object_key = key

    if folder:
        folder = folder.rstrip("/")
        object_key = f"{folder}/{object_key}"

    try:
        meta = await storage.upload(
            key=object_key,
            data=data,
            content_type=content_type,
            metadata={"original_filename": file.filename or ""},
        )
    except StorageBackendError as exc:
        logger.error("files.upload_error", key=object_key, error=str(exc))
        raise HTTPException(status_code=502, detail=exc.to_dict())

    logger.info("files.uploaded", key=object_key, size=len(data))
    return _meta_to_response(meta)


@router.get(
    "/{key:path}",
    summary="Download a file",
    description="Stream the raw file content back to the caller.",
    responses={404: {"model": None, "description": "Object not found"}},
)
async def download_file(key: str, storage: StorageDep) -> Response:
    try:
        data = await storage.download(key)
        meta = await storage.stat(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return Response(
        content=data,
        media_type=meta.content_type or "application/octet-stream",
        headers={"ETag": meta.etag, "Content-Disposition": f'attachment; filename="{key.split("/")[-1]}"'},
    )


@router.get(
    "/{key:path}/stat",
    response_model=ObjectMetadataResponse,
    summary="Object metadata",
    description="Return metadata for an object without downloading its content.",
)
async def stat_file(key: str, storage: StorageDep) -> ObjectMetadataResponse:
    try:
        meta = await storage.stat(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return _meta_to_response(meta)


@router.post(
    "/{key:path}/presign",
    response_model=PresignedUrlResponse,
    summary="Generate pre-signed URL",
    description=(
        "Generate a time-limited pre-signed URL for direct client "
        "upload (PUT) or download (GET) without proxying through this service."
    ),
)
async def presign(key: str, body: PresignRequest, storage: StorageDep) -> PresignedUrlResponse:
    try:
        result = await storage.generate_presigned_url(
            key=key,
            expires_in=body.expires_in,
            method=body.method,
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return PresignedUrlResponse(
        url=result.url,
        expires_in_seconds=result.expires_in_seconds,
        method=result.method,
    )


@router.delete(
    "/{key:path}",
    response_model=DeleteResponse,
    summary="Delete an object",
)
async def delete_file(key: str, storage: StorageDep) -> DeleteResponse:
    try:
        await storage.delete(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    logger.info("files.deleted", key=key)
    return DeleteResponse(key=key, deleted=True)


@router.get(
    "",
    response_model=ListObjectsResponse,
    summary="List objects",
    description="List stored objects, optionally filtered by a key prefix.",
)
async def list_files(
    storage: StorageDep,
    prefix: str = Query(default="", description="Key prefix filter"),
    max_keys: int = Query(default=100, ge=1, le=1000),
) -> ListObjectsResponse:
    try:
        objects = await storage.list_objects(prefix=prefix, max_keys=max_keys)
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return ListObjectsResponse(
        objects=[_meta_to_response(o) for o in objects],
        count=len(objects),
        prefix=prefix,
    )
