# =============================================================================
# SericeStore — Multi-stage Dockerfile
# Stage 1: builder  — installs Python dependencies
# Stage 2: runtime  — lean production image with ImageMagick & FFmpeg
# =============================================================================

# ---------- Stage 1: builder -------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies (needed to compile some Python packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libmagickwand-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies into an isolated prefix
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ---------- Stage 2: runtime -------------------------------------------------
FROM python:3.12-slim AS runtime

LABEL maintainer="SericeStore <engineering@example.com>"
LABEL org.opencontainers.image.title="SericeStore"
LABEL org.opencontainers.image.description="Storage & Media Processing Service"

# Install system dependencies:
#   - ImageMagick (wand binding)
#   - FFmpeg + FFprobe
RUN apt-get update && apt-get install -y --no-install-recommends \
    imagemagick \
    libmagickwand-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ImageMagick security policy: allow reading/writing all formats in a container.
# For production, tighten this policy based on your actual format requirements.
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' \
    /etc/ImageMagick-6/policy.xml 2>/dev/null || true

# Copy installed Python packages from the builder stage
COPY --from=builder /install /usr/local

# Create a non-root user to run the application
RUN groupadd -r sericestore && useradd -r -g sericestore -d /app sericestore

WORKDIR /app

# Copy application source
COPY --chown=sericestore:sericestore . .

# Create required directories
RUN mkdir -p /tmp/sericestore && chown sericestore:sericestore /tmp/sericestore

# Switch to non-root user
USER sericestore

# Expose the API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Start Uvicorn (production: multiple workers, no reload)
CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "4", \
     "--log-config", "/dev/null"]
