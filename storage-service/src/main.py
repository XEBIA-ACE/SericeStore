"""
Storage Service – application entry point.

Initialises FastAPI, registers routers, attaches middleware, and wires up
the lifespan context (startup / shutdown hooks).
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from src.api.v1.middleware import RequestLoggingMiddleware, register_exception_handlers
from src.api.v1.routes import files, health, images, videos
from src.core.config import get_settings
from src.core.logging import configure_logging, get_logger
from src.services.storage import create_storage_backend

settings = get_settings()
configure_logging(log_level=settings.log_level, log_format=settings.log_format)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Startup / shutdown lifecycle hook.

    On startup  – ensure the configured bucket exists.
    On shutdown – log a clean shutdown message (add cleanup logic here).
    """
    logger.info(
        "startup",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment.value,
        backend=settings.storage_backend.value,
    )
    try:
        storage = create_storage_backend(settings)
        await storage.ensure_bucket()
        logger.info("startup.storage_ready", backend=settings.storage_backend.value)
    except Exception as exc:
        # Do not crash on startup if the storage backend is temporarily unavailable.
        # The /ready endpoint will surface the degraded state.
        logger.error("startup.storage_error", error=str(exc))

    yield

    logger.info("shutdown", service=settings.app_name)


def create_app() -> FastAPI:
    """
    Application factory – can be imported by tests to get a fresh app instance.
    """
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Multi-cloud object storage service with integrated image (ImageMagick) "
            "and video (FFmpeg) processing. Supports Amazon S3, Google Cloud Storage, "
            "and MinIO as storage backends."
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # ── Middleware (outermost first) ──────────────────────────────────────────
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(RequestLoggingMiddleware)

    # ── Exception handlers ────────────────────────────────────────────────────
    register_exception_handlers(app)

    # ── Routers ───────────────────────────────────────────────────────────────
    API_PREFIX = "/api/v1"

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(files.router, prefix=API_PREFIX)
    app.include_router(images.router, prefix=API_PREFIX)
    app.include_router(videos.router, prefix=API_PREFIX)

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        workers=settings.workers,
        reload=settings.reload,
        log_config=None,   # structlog handles all logging
    )
