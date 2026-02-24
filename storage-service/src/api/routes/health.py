"""
Health check and metrics endpoints.
GET /health       — liveness probe
GET /health/ready — readiness probe (checks storage backend)
GET /metrics      — basic application metrics
"""
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.core.config import get_settings
from src.infrastructure.storage import get_storage_backend

router = APIRouter(tags=["Health"])

_startup_time = time.time()


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    environment: str
    timestamp: str
    uptime_seconds: float


class ReadinessResponse(HealthResponse):
    storage_backend: str
    storage_healthy: bool


class MetricsResponse(BaseModel):
    uptime_seconds: float
    service: str
    version: str
    storage_backend: str


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description="Returns 200 as long as the process is running.",
)
async def liveness():
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment.value,
        timestamp=datetime.now(timezone.utc).isoformat(),
        uptime_seconds=round(time.time() - _startup_time, 2),
    )


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description="Checks connectivity to the storage backend.",
)
async def readiness():
    settings = get_settings()
    storage = get_storage_backend()
    storage_ok = await storage.health_check()

    return ReadinessResponse(
        status="ok" if storage_ok else "degraded",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment.value,
        timestamp=datetime.now(timezone.utc).isoformat(),
        uptime_seconds=round(time.time() - _startup_time, 2),
        storage_backend=settings.storage_backend.value,
        storage_healthy=storage_ok,
    )


@router.get(
    "/metrics",
    response_model=MetricsResponse,
    summary="Basic metrics",
    description="Lightweight metrics endpoint (extend with Prometheus if needed).",
)
async def metrics():
    settings = get_settings()
    return MetricsResponse(
        uptime_seconds=round(time.time() - _startup_time, 2),
        service=settings.app_name,
        version=settings.app_version,
        storage_backend=settings.storage_backend.value,
    )
