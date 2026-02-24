"""
SericeStore — Storage & Media Processing Service
Entry point: creates the FastAPI application, registers routes and middleware.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.middleware.logging import RequestLoggingMiddleware
from src.api.routes.files import router as files_router
from src.api.routes.health import router as health_router
from src.api.routes.media import router as media_router
from src.core.config import get_settings
from src.core.exceptions import (
    FileTooLargeError,
    ObjectNotFoundError,
    SericeStoreError,
    UnsupportedMediaTypeError,
    ValidationError,
)
from src.core.logging import get_logger, setup_logging
from src.infrastructure.storage import get_storage_backend
from src.infrastructure.storage.base import ensure_temp_dir

setup_logging()
logger = get_logger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Lifespan: startup / shutdown hooks
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialise resources on startup."""
    logger.info(
        "sericestore_starting",
        version=settings.app_version,
        backend=settings.storage_backend.value,
        environment=settings.environment.value,
    )

    # Ensure temp directory exists for media processing
    ensure_temp_dir(settings.temp_dir)

    # Verify storage backend is reachable and bucket exists
    storage = get_storage_backend()
    try:
        await storage.ensure_bucket_exists()
        logger.info("storage_backend_ready", backend=settings.storage_backend.value)
    except Exception as exc:
        logger.error("storage_backend_init_failed", error=str(exc))
        # Don't crash on startup; health/ready endpoint will report degraded status.

    yield

    logger.info("sericestore_shutting_down")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    app = FastAPI(
        title="SericeStore",
        description=(
            "A production-ready storage and media processing service supporting "
            "Amazon S3, Google Cloud Storage, MinIO, ImageMagick, and FFmpeg."
        ),
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------------
    # Request logging
    # ------------------------------------------------------------------
    app.add_middleware(RequestLoggingMiddleware)

    # ------------------------------------------------------------------
    # Global exception handlers
    # ------------------------------------------------------------------

    @app.exception_handler(ObjectNotFoundError)
    async def not_found_handler(request: Request, exc: ObjectNotFoundError):
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": exc.message, "type": "not_found"},
        )

    @app.exception_handler(FileTooLargeError)
    async def too_large_handler(request: Request, exc: FileTooLargeError):
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": exc.message, "type": "file_too_large", **exc.details},
        )

    @app.exception_handler(UnsupportedMediaTypeError)
    async def unsupported_type_handler(request: Request, exc: UnsupportedMediaTypeError):
        return JSONResponse(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            content={"detail": exc.message, "type": "unsupported_media_type"},
        )

    @app.exception_handler(ValidationError)
    async def validation_handler(request: Request, exc: ValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.message, "type": "validation_error"},
        )

    @app.exception_handler(SericeStoreError)
    async def generic_handler(request: Request, exc: SericeStoreError):
        logger.error("unhandled_application_error", error=exc.message, details=exc.details)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal error occurred", "type": "internal_error"},
        )

    # ------------------------------------------------------------------
    # Routers
    # ------------------------------------------------------------------
    app.include_router(health_router)                           # /health, /metrics
    app.include_router(files_router, prefix=settings.api_prefix)   # /api/v1/files
    app.include_router(media_router, prefix=settings.api_prefix)   # /api/v1/media

    return app


app = create_app()


# ---------------------------------------------------------------------------
# Dev server entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        workers=1 if settings.debug else settings.workers,
        log_config=None,  # structlog handles logging
    )
