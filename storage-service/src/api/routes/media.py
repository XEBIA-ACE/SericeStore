"""
Media processing endpoints.

Image:
  POST /media/images/resize
  POST /media/images/thumbnail
  POST /media/images/convert
  POST /media/images/crop
  POST /media/images/watermark
  GET  /media/images/{key:path}/metadata

Video:
  POST /media/videos/transcode
  POST /media/videos/frame
  POST /media/videos/audio
  POST /media/videos/gif
  GET  /media/videos/{key:path}/metadata
"""
from fastapi import APIRouter, Depends, HTTPException, status

from src.api.middleware.auth import get_current_user
from src.api.schemas.media import (
    AudioExtractRequest,
    GifCreateRequest,
    ImageConvertRequest,
    ImageCropRequest,
    ImageMetadataResponse,
    ImageResizeRequest,
    ImageThumbnailRequest,
    ImageWatermarkRequest,
    MediaProcessingResponse,
    VideoFrameRequest,
    VideoMetadataResponse,
    VideoTranscodeRequest,
)
from src.core.exceptions import ObjectNotFoundError, UnsupportedMediaTypeError
from src.infrastructure.media import get_image_processor, get_video_processor
from src.infrastructure.storage import get_storage_backend
from src.services.file_service import FileService
from src.services.media_service import MediaService

router = APIRouter(prefix="/media", tags=["Media Processing"])


def get_media_service() -> MediaService:
    storage = get_storage_backend()
    file_svc = FileService(storage=storage)
    return MediaService(
        file_service=file_svc,
        image_processor=get_image_processor(),
        video_processor=get_video_processor(),
    )


# ---------------------------------------------------------------------------
# Image endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/images/resize",
    response_model=MediaProcessingResponse,
    status_code=status.HTTP_200_OK,
    summary="Resize an image",
)
async def resize_image(
    request: ImageResizeRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.resize_image(
            source_key=request.source_key,
            width=request.width,
            height=request.height,
            maintain_aspect=request.maintain_aspect,
            output_format=request.output_format,
            quality=request.quality,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="resize",
    )


@router.post(
    "/images/thumbnail",
    response_model=MediaProcessingResponse,
    summary="Create an image thumbnail",
)
async def create_thumbnail(
    request: ImageThumbnailRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.create_thumbnail(
            source_key=request.source_key,
            width=request.width,
            height=request.height,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="thumbnail",
    )


@router.post(
    "/images/convert",
    response_model=MediaProcessingResponse,
    summary="Convert image format",
)
async def convert_image(
    request: ImageConvertRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.convert_image(
            source_key=request.source_key,
            output_format=request.output_format,
            quality=request.quality,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="convert",
    )


@router.post(
    "/images/crop",
    response_model=MediaProcessingResponse,
    summary="Crop an image",
)
async def crop_image(
    request: ImageCropRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.crop_image(
            source_key=request.source_key,
            left=request.left,
            top=request.top,
            width=request.width,
            height=request.height,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="crop",
    )


@router.post(
    "/images/watermark",
    response_model=MediaProcessingResponse,
    summary="Apply watermark to an image",
)
async def watermark_image(
    request: ImageWatermarkRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.add_watermark(
            source_key=request.source_key,
            watermark_key=request.watermark_key,
            gravity=request.gravity,
            opacity=request.opacity,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="watermark",
    )


@router.get(
    "/images/{key:path}/metadata",
    response_model=ImageMetadataResponse,
    summary="Get image metadata",
    description="Extracts metadata from a stored image using ImageMagick's identify.",
)
async def get_image_metadata(
    key: str,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        meta = await service.get_image_metadata(key)
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return ImageMetadataResponse(
        width=meta.width,
        height=meta.height,
        format=meta.format,
        color_space=meta.color_space,
        depth=meta.depth,
        size_bytes=meta.size_bytes,
        has_alpha=meta.has_alpha,
        dpi=meta.dpi,
        exif=meta.exif,
    )


# ---------------------------------------------------------------------------
# Video endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/videos/transcode",
    response_model=MediaProcessingResponse,
    summary="Transcode a video",
    description="Re-encode a video to the specified format and codec settings using FFmpeg.",
)
async def transcode_video(
    request: VideoTranscodeRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.transcode_video(
            source_key=request.source_key,
            output_format=request.output_format,
            video_codec=request.video_codec,
            audio_codec=request.audio_codec,
            crf=request.crf,
            preset=request.preset,
            width=request.width,
            height=request.height,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="transcode",
    )


@router.post(
    "/videos/frame",
    response_model=MediaProcessingResponse,
    summary="Extract a video frame",
    description="Extract a single frame from a video at the given timestamp.",
)
async def extract_frame(
    request: VideoFrameRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.extract_video_frame(
            source_key=request.source_key,
            timestamp_seconds=request.timestamp_seconds,
            width=request.width,
            height=request.height,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="frame_extract",
    )


@router.post(
    "/videos/audio",
    response_model=MediaProcessingResponse,
    summary="Extract audio track",
)
async def extract_audio(
    request: AudioExtractRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.extract_audio_track(
            source_key=request.source_key,
            output_format=request.output_format,
            bitrate=request.bitrate,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="audio_extract",
    )


@router.post(
    "/videos/gif",
    response_model=MediaProcessingResponse,
    summary="Create animated GIF from video",
)
async def create_gif(
    request: GifCreateRequest,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        result_key = await service.create_gif_from_video(
            source_key=request.source_key,
            start_seconds=request.start_seconds,
            duration_seconds=request.duration_seconds,
            width=request.width,
            fps=request.fps,
            result_prefix=request.result_prefix,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=exc.message)

    return MediaProcessingResponse(
        source_key=request.source_key,
        result_key=result_key,
        operation="gif_create",
    )


@router.get(
    "/videos/{key:path}/metadata",
    response_model=VideoMetadataResponse,
    summary="Get video metadata",
    description="Extract metadata from a stored video using FFprobe.",
)
async def get_video_metadata(
    key: str,
    service: MediaService = Depends(get_media_service),
    _user: dict = Depends(get_current_user),
):
    try:
        meta = await service.get_video_metadata(key)
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return VideoMetadataResponse(
        duration_seconds=meta.duration_seconds,
        width=meta.width,
        height=meta.height,
        fps=meta.fps,
        video_codec=meta.video_codec,
        audio_codec=meta.audio_codec,
        bitrate_kbps=meta.bitrate_kbps,
        size_bytes=meta.size_bytes,
        format=meta.format,
    )
