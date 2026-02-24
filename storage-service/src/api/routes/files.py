"""
File management endpoints.

POST   /files/upload          — multipart file upload
POST   /files/upload-url      — generate presigned upload URL
GET    /files/{key:path}      — download a file
HEAD   /files/{key:path}      — get file metadata
DELETE /files/{key:path}      — delete a file
GET    /files                 — list files with optional prefix
GET    /files/{key:path}/url  — generate presigned download URL
"""
from typing import Annotated, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import Response, StreamingResponse

from src.api.middleware.auth import get_current_user
from src.api.schemas.file import (
    DeleteResponse,
    FileInfoResponse,
    FileListResponse,
    FileUploadResponse,
    PresignedDownloadResponse,
    PresignedUploadRequest,
    PresignedUploadResponse,
)
from src.core.exceptions import (
    FileTooLargeError,
    ObjectNotFoundError,
    UnsupportedMediaTypeError,
    ValidationError,
)
from src.infrastructure.storage import get_storage_backend
from src.services.file_service import FileService

router = APIRouter(prefix="/files", tags=["Files"])


def get_file_service() -> FileService:
    """FastAPI dependency that provides a FileService instance."""
    return FileService(storage=get_storage_backend())


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@router.post(
    "/upload",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a file",
    description=(
        "Upload a file via multipart/form-data. "
        "The file is stored in the configured backend (S3, GCS, or MinIO). "
        "Optional `prefix` sets a path prefix within the bucket."
    ),
)
async def upload_file(
    file: UploadFile = File(..., description="The file to upload"),
    prefix: str = Form("", description="Optional path prefix within the bucket"),
    metadata: Optional[str] = Form(
        None,
        description='JSON string of extra metadata key-value pairs e.g. {"tag":"avatar"}',
    ),
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    import json

    extra_meta: dict = {}
    if metadata:
        try:
            extra_meta = json.loads(metadata)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="metadata must be valid JSON",
            )

    data = await file.read()
    try:
        stored = await service.upload_file(
            filename=file.filename or "upload",
            data=data,
            content_type=file.content_type,
            prefix=prefix,
            metadata=extra_meta,
        )
    except FileTooLargeError as exc:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=exc.message)
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return FileUploadResponse(
        id=stored.id,
        key=stored.key,
        bucket=stored.bucket,
        backend=stored.backend,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        original_filename=stored.original_filename,
        etag=stored.etag,
        created_at=stored.created_at,
        metadata=stored.metadata,
    )


@router.post(
    "/upload-url",
    response_model=PresignedUploadResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a presigned upload URL",
    description=(
        "Returns a presigned URL the client can use to upload directly to storage "
        "without routing the bytes through this service."
    ),
)
async def generate_upload_url(
    request: PresignedUploadRequest,
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    result = await service.get_upload_url(
        filename=request.filename,
        content_type=request.content_type,
        prefix=request.prefix,
        expires_in=request.expires_in,
    )
    settings_expiry = service._settings.presigned_url_expiry
    return PresignedUploadResponse(
        key=result["key"],
        url=result["url"],
        fields=result.get("fields", {}),
        method=result.get("method", "POST"),
        expires_in=request.expires_in or settings_expiry,
    )


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

@router.get(
    "/{key:path}/url",
    response_model=PresignedDownloadResponse,
    summary="Generate presigned download URL",
)
async def get_download_url(
    key: str,
    expires_in: int = Query(3600, ge=60, le=604800),
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    try:
        url = await service.get_download_url(key, expires_in=expires_in)
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return PresignedDownloadResponse(key=key, url=url, expires_in=expires_in)


@router.get(
    "/{key:path}",
    summary="Download a file",
    description="Stream the raw file bytes back to the client.",
    responses={
        200: {"description": "File content", "content": {"application/octet-stream": {}}},
        404: {"description": "File not found"},
    },
)
async def download_file(
    key: str,
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    try:
        info = await service.get_file_info(key)
    except ObjectNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Object not found: {key}")

    async def _stream():
        async for chunk in service.stream_file(key):
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type=info.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{info.original_filename or key.split("/")[-1]}"',
            "X-File-Key": key,
            "X-File-Size": str(info.size_bytes),
        },
    )


# ---------------------------------------------------------------------------
# Metadata (HEAD)
# ---------------------------------------------------------------------------

@router.head(
    "/{key:path}",
    summary="Get file metadata",
    description="Returns headers with file size, content-type, and ETag.",
)
async def head_file(
    key: str,
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    try:
        info = await service.get_file_info(key)
    except ObjectNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Object not found: {key}")

    return Response(
        headers={
            "Content-Type": info.content_type,
            "Content-Length": str(info.size_bytes),
            "ETag": info.etag or "",
            "X-File-Key": key,
        }
    )


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=FileListResponse,
    summary="List files",
    description="List stored files with optional prefix filter and pagination.",
)
async def list_files(
    prefix: str = Query("", description="Key prefix filter"),
    max_keys: int = Query(100, ge=1, le=1000),
    continuation_token: Optional[str] = Query(None),
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    try:
        files, next_token = await service.list_files(
            prefix=prefix,
            max_keys=max_keys,
            continuation_token=continuation_token,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.message)

    items = [
        FileUploadResponse(
            id=f.id,
            key=f.key,
            bucket=f.bucket,
            backend=f.backend,
            content_type=f.content_type,
            size_bytes=f.size_bytes,
            original_filename=f.original_filename,
            etag=f.etag,
            created_at=f.created_at,
            metadata=f.metadata,
        )
        for f in files
    ]
    return FileListResponse(
        items=items,
        count=len(items),
        next_token=next_token,
        prefix=prefix,
    )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete(
    "/{key:path}",
    response_model=DeleteResponse,
    summary="Delete a file",
)
async def delete_file(
    key: str,
    service: FileService = Depends(get_file_service),
    _user: dict = Depends(get_current_user),
):
    try:
        await service.delete_file(key)
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return DeleteResponse(key=key, deleted=True)
