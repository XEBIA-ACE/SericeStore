"""Integration tests for health / readiness endpoints."""

import pytest


@pytest.mark.asyncio
async def test_health(async_client):
    response = await async_client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert "storage_backend" in body


@pytest.mark.asyncio
async def test_ready(async_client):
    # In-memory backend always passes the readiness check
    response = await async_client.get("/api/v1/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"]["storage"] == "ok"


@pytest.mark.asyncio
async def test_metrics(async_client):
    response = await async_client.get("/api/v1/metrics")
    assert response.status_code == 200
    body = response.json()
    assert "uptime_seconds" in body
