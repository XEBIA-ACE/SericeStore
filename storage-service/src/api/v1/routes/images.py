"""
Image processing endpoints.

POST /images/upload            – upload and optionally process in one step
GET  /images/{key}/info        – probe image metadata
POST /images/{key}/resize      – resize a stored image
POST /images/{key}/thumbnail   – generate a thumbnail for a stored image
POST /images/{key}/convert     – convert format of a stored image
POST /images/{key}/watermark   – overlay a watermark on a stored image
"""

import mimetypes
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from src.api.v1.dependencies import ImageDep, SettingsDep, StorageDep
from src.core.exceptions import (
    FileNotFoundError,
    FileTooLargeError,
    ImageProcessingError,
    StorageBackendError,
    UnsupportedMediaTypeError,
)
from src.core.logging import get_logger
from src.models.schemas import (
    ImageInfoResponse,
    ImageProcessResponse,
    ImageResizeRequest,
    ObjectMetadataResponse,
)

router = APIRouter(prefix="/images", tags=["Images"])
logger = get_logger(__name__)

_ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/avif", "image/tiff", "image/bmp",
}


def _assert_image(content_type: Optional[str]) -> None:
    if content_type not in _ALLOWED_TYPES:
        raise UnsupportedMediaTypeError(
            f"Content-Type {content_type!r} is not an allowed image type. "
            f"Allowed: {sorted(_ALLOWED_TYPES)}"
        )


@router.post(
    "/upload",
    response_model=ObjectMetadataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an image",
)
async def upload_image(
    storage: StorageDep,
    settings: SettingsDep,
    file: UploadFile = File(...),
    folder: Optional[str] = Query(default="images"),
) -> ObjectMetadataResponse:
    try:
        _assert_image(file.content_type)
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=415, detail=exc.to_dict())

    data = await file.read()
    if len(data) > settings.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    ext = mimetypes.guess_extension(file.content_type or "") or ".bin"
    key = f"{folder}/{uuid.uuid4().hex}{ext}"

    try:
        meta = await storage.upload(
            key=key,
            data=data,
            content_type=file.content_type or "application/octet-stream",
            metadata={"original_filename": file.filename or ""},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return ObjectMetadataResponse(
        key=meta.key, bucket=meta.bucket, size=meta.size,
        content_type=meta.content_type, etag=meta.etag, url=meta.url,
    )


@router.get(
    "/{key:path}/info",
    response_model=ImageInfoResponse,
    summary="Image metadata",
    description="Probe dimensions, format and colour space of a stored image.",
)
async def image_info(key: str, storage: StorageDep, image_svc: ImageDep) -> ImageInfoResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        info = await image_svc.get_info(data)
    except ImageProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    return ImageInfoResponse(
        width=info.width, height=info.height, format=info.format,
        color_space=info.color_space, depth=info.depth, size_bytes=info.size_bytes,
    )


@router.post(
    "/{key:path}/resize",
    response_model=ImageProcessResponse,
    summary="Resize an image",
    description=(
        "Resize the stored image and save the result as a new object. "
        "The original is kept unchanged."
    ),
)
async def resize_image(
    key: str,
    body: ImageResizeRequest,
    storage: StorageDep,
    image_svc: ImageDep,
    output_folder: str = Query(default="images/resized"),
) -> ImageProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        result = await image_svc.resize(
            data=data,
            width=body.width,
            height=body.height,
            output_format=body.output_format,
            fit=body.fit,
        )
    except ImageProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    new_key = f"{output_folder}/{uuid.uuid4().hex}.{body.output_format}"
    try:
        meta = await storage.upload(
            key=new_key,
            data=result.data,
            content_type=result.content_type,
            metadata={"source_key": key},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    logger.info("images.resized", source=key, result=new_key)
    return ImageProcessResponse(
        key=meta.key, content_type=meta.content_type,
        width=result.width, height=result.height,
        format=result.format, size=len(result.data), url=meta.url,
    )


@router.post(
    "/{key:path}/thumbnail",
    response_model=ImageProcessResponse,
    summary="Generate thumbnail",
)
async def thumbnail(
    key: str,
    storage: StorageDep,
    image_svc: ImageDep,
    output_format: str = Query(default="jpeg"),
    output_folder: str = Query(default="images/thumbnails"),
) -> ImageProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        result = await image_svc.thumbnail(data=data, output_format=output_format)
    except ImageProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    new_key = f"{output_folder}/{uuid.uuid4().hex}.{output_format}"
    try:
        meta = await storage.upload(
            key=new_key,
            data=result.data,
            content_type=result.content_type,
            metadata={"source_key": key},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return ImageProcessResponse(
        key=meta.key, content_type=meta.content_type,
        width=result.width, height=result.height,
        format=result.format, size=len(result.data), url=meta.url,
    )


@router.post(
    "/{key:path}/convert",
    response_model=ImageProcessResponse,
    summary="Convert image format",
)
async def convert_format(
    key: str,
    storage: StorageDep,
    image_svc: ImageDep,
    target_format: str = Query(default="webp"),
    output_folder: str = Query(default="images/converted"),
) -> ImageProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        result = await image_svc.convert_format(data=data, target_format=target_format)
    except ImageProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    new_key = f"{output_folder}/{uuid.uuid4().hex}.{target_format}"
    try:
        meta = await storage.upload(
            key=new_key,
            data=result.data,
            content_type=result.content_type,
            metadata={"source_key": key},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return ImageProcessResponse(
        key=meta.key, content_type=meta.content_type,
        width=result.width, height=result.height,
        format=result.format, size=len(result.data), url=meta.url,
    )


@router.post(
    "/{key:path}/watermark",
    response_model=ImageProcessResponse,
    summary="Apply watermark",
    description="Overlay a watermark image (uploaded as a multipart field) onto the stored image.",
)
async def watermark(
    key: str,
    storage: StorageDep,
    image_svc: ImageDep,
    watermark_file: UploadFile = File(..., description="Watermark image (PNG recommended)"),
    gravity: str = Query(default="SouthEast"),
    output_format: str = Query(default="jpeg"),
    output_folder: str = Query(default="images/watermarked"),
) -> ImageProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    wm_data = await watermark_file.read()

    try:
        result = await image_svc.watermark(
            data=data,
            watermark_data=wm_data,
            gravity=gravity,
            output_format=output_format,
        )
    except ImageProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    new_key = f"{output_folder}/{uuid.uuid4().hex}.{output_format}"
    try:
        meta = await storage.upload(
            key=new_key,
            data=result.data,
            content_type=result.content_type,
            metadata={"source_key": key},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return ImageProcessResponse(
        key=meta.key, content_type=meta.content_type,
        width=result.width, height=result.height,
        format=result.format, size=len(result.data), url=meta.url,
    )
