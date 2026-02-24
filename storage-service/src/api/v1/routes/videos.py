"""
Video processing endpoints.

POST /videos/upload              – upload a video
GET  /videos/{key}/info          – probe video metadata
GET  /videos/{key}/thumbnail     – extract a frame as JPEG
POST /videos/{key}/transcode     – transcode to a different codec/container
POST /videos/{key}/clip          – cut a clip from a video
POST /videos/{key}/extract-audio – strip the audio track
"""

import mimetypes
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from src.api.v1.dependencies import SettingsDep, StorageDep, VideoDep
from src.core.exceptions import (
    FileNotFoundError,
    MediaProbeError,
    StorageBackendError,
    UnsupportedMediaTypeError,
    VideoProcessingError,
)
from src.core.logging import get_logger
from src.models.schemas import (
    ObjectMetadataResponse,
    VideoClipRequest,
    VideoInfoResponse,
    VideoProcessResponse,
    VideoTranscodeRequest,
)

router = APIRouter(prefix="/videos", tags=["Videos"])
logger = get_logger(__name__)

_ALLOWED_VIDEO_TYPES = {
    "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
    "video/x-matroska", "video/mpeg", "video/ogg",
}


@router.post(
    "/upload",
    response_model=ObjectMetadataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a video",
)
async def upload_video(
    storage: StorageDep,
    settings: SettingsDep,
    file: UploadFile = File(...),
    folder: Optional[str] = Query(default="videos"),
) -> ObjectMetadataResponse:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ALLOWED_VIDEO_TYPES:
        raise HTTPException(
            status_code=415,
            detail={
                "error": "UNSUPPORTED_MEDIA_TYPE",
                "message": f"{content_type!r} is not an allowed video type.",
            },
        )

    data = await file.read()
    if len(data) > settings.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    ext = mimetypes.guess_extension(content_type) or ".bin"
    key = f"{folder}/{uuid.uuid4().hex}{ext}"

    try:
        meta = await storage.upload(
            key=key,
            data=data,
            content_type=content_type,
            metadata={"original_filename": file.filename or ""},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    logger.info("videos.uploaded", key=key, size=len(data))
    return ObjectMetadataResponse(
        key=meta.key, bucket=meta.bucket, size=meta.size,
        content_type=meta.content_type, etag=meta.etag, url=meta.url,
    )


@router.get(
    "/{key:path}/info",
    response_model=VideoInfoResponse,
    summary="Video metadata",
    description="Probe streams, duration, codec, and bitrate using FFprobe.",
)
async def video_info(key: str, storage: StorageDep, video_svc: VideoDep) -> VideoInfoResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        info = await video_svc.probe(data)
    except (MediaProbeError, VideoProcessingError) as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    return VideoInfoResponse(
        duration_seconds=info.duration_seconds,
        width=info.width,
        height=info.height,
        codec_video=info.codec_video,
        codec_audio=info.codec_audio,
        bitrate_kbps=info.bitrate_kbps,
        fps=info.fps,
        size_bytes=info.size_bytes,
        format_name=info.format_name,
    )


@router.get(
    "/{key:path}/thumbnail",
    summary="Extract video frame",
    description="Return a JPEG snapshot of the video at the given time offset.",
)
async def video_thumbnail(
    key: str,
    storage: StorageDep,
    video_svc: VideoDep,
    time_offset: Optional[str] = Query(default=None, description="HH:MM:SS or seconds"),
    width: int = Query(default=640, ge=1, le=3840),
) -> Response:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        thumb = await video_svc.extract_thumbnail(
            data=data,
            time_offset=time_offset,
            width=width,
        )
    except VideoProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    return Response(content=thumb, media_type="image/jpeg")


@router.post(
    "/{key:path}/transcode",
    response_model=VideoProcessResponse,
    summary="Transcode video",
    description="Transcode to a different codec or container and persist the result.",
)
async def transcode(
    key: str,
    body: VideoTranscodeRequest,
    storage: StorageDep,
    video_svc: VideoDep,
    output_folder: str = Query(default="videos/transcoded"),
) -> VideoProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        result = await video_svc.transcode(
            data=data,
            output_format=body.output_format,
            video_codec=body.video_codec,
            audio_codec=body.audio_codec,
            crf=body.crf,
            preset=body.preset,
            max_width=body.max_width,
        )
    except VideoProcessingError as exc:
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

    logger.info("videos.transcoded", source=key, result=new_key)
    return VideoProcessResponse(
        key=meta.key, content_type=meta.content_type,
        format=result.format, size=len(result.data), url=meta.url,
    )


@router.post(
    "/{key:path}/clip",
    response_model=VideoProcessResponse,
    summary="Cut a video clip",
)
async def clip(
    key: str,
    body: VideoClipRequest,
    storage: StorageDep,
    video_svc: VideoDep,
    output_folder: str = Query(default="videos/clips"),
) -> VideoProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        result = await video_svc.clip(
            data=data,
            start=body.start,
            duration=body.duration,
            output_format=body.output_format,
        )
    except VideoProcessingError as exc:
        raise HTTPException(status_code=422, detail=exc.to_dict())

    new_key = f"{output_folder}/{uuid.uuid4().hex}.{body.output_format}"
    try:
        meta = await storage.upload(
            key=new_key,
            data=result.data,
            content_type=result.content_type,
            metadata={"source_key": key, "clip_start": body.start, "clip_duration": body.duration},
        )
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    return VideoProcessResponse(
        key=meta.key, content_type=meta.content_type,
        format=result.format, size=len(result.data), url=meta.url,
    )


@router.post(
    "/{key:path}/extract-audio",
    response_model=VideoProcessResponse,
    summary="Extract audio track",
)
async def extract_audio(
    key: str,
    storage: StorageDep,
    video_svc: VideoDep,
    output_format: str = Query(default="mp3"),
    bitrate: str = Query(default="192k"),
    output_folder: str = Query(default="audio"),
) -> VideoProcessResponse:
    try:
        data = await storage.download(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.to_dict())
    except StorageBackendError as exc:
        raise HTTPException(status_code=502, detail=exc.to_dict())

    try:
        result = await video_svc.extract_audio(
            data=data,
            output_format=output_format,
            bitrate=bitrate,
        )
    except VideoProcessingError as exc:
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

    return VideoProcessResponse(
        key=meta.key, content_type=meta.content_type,
        format=result.format, size=len(result.data), url=meta.url,
    )
