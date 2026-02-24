# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for the Storage Service
#
# Stage 1 (builder): install Python dependencies in an isolated layer
# Stage 2 (runtime): lean final image with system tools (ImageMagick, FFmpeg)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build tools needed for native extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --upgrade pip \
 && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Install system-level media tools
RUN apt-get update && apt-get install -y --no-install-recommends \
        # ImageMagick
        imagemagick \
        # FFmpeg + FFprobe
        ffmpeg \
        # MIME-type detection support for python-magic
        libmagic1 \
        # Timezone data
        tzdata \
        # curl for healthcheck
        curl \
    && rm -rf /var/lib/apt/lists/*

# Allow ImageMagick to process all file types (relax default security policy
# for trusted internal workloads; tighten for public-facing deployments)
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' \
    /etc/ImageMagick-6/policy.xml 2>/dev/null || true

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Non-root user for security
RUN groupadd --gid 1001 appgroup \
 && useradd  --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy application source
COPY src/ src/

# Ensure Python finds the src package
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["python", "-m", "uvicorn", "src.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--log-config", "/dev/null"]
