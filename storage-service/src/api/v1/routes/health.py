"""
Health check and readiness endpoints.

/health  – liveness probe (always returns 200 if the process is alive)
/ready   – readiness probe (checks connectivity to the storage backend)
/metrics – basic Prometheus-style counters (placeholder for Prometheus integration)
"""

import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api.v1.dependencies import SettingsDep, StorageDep
from src.core.logging import get_logger
from src.models.schemas import HealthResponse

router = APIRouter(tags=["Health"])
logger = get_logger(__name__)

# Simple in-process counter (replace with Prometheus client in production)
_start_time = time.time()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description="Returns 200 when the service process is running.",
)
async def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=settings.app_version,
        storage_backend=settings.storage_backend.value,
        checks={},
    )


@router.get(
    "/ready",
    response_model=HealthResponse,
    summary="Readiness probe",
    description="Verifies storage backend connectivity before accepting traffic.",
)
async def ready(settings: SettingsDep, storage: StorageDep) -> JSONResponse:
    checks: dict[str, str] = {}
    status = "ok"
    http_status = 200

    # Probe storage by listing with an empty prefix (cheap operation)
    try:
        await storage.list_objects(prefix="__healthcheck__", max_keys=1)
        checks["storage"] = "ok"
    except Exception as exc:
        logger.warning("readiness.storage_fail", error=str(exc))
        checks["storage"] = f"error: {exc}"
        status = "degraded"
        http_status = 503

    body = HealthResponse(
        status=status,
        version=settings.app_version,
        storage_backend=settings.storage_backend.value,
        checks=checks,
    )
    return JSONResponse(content=body.model_dump(), status_code=http_status)


@router.get(
    "/metrics",
    summary="Basic metrics",
    description="Returns basic service metrics. Integrate with Prometheus client for full observability.",
)
async def metrics() -> dict:
    uptime = time.time() - _start_time
    return {
        "uptime_seconds": round(uptime, 2),
        "note": "Integrate prometheus_client for full /metrics exposition.",
    }
