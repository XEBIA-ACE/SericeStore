# Storage Service

A production-ready, multi-cloud object storage microservice with integrated image and video processing.

## Features

| Feature | Details |
|---|---|
| **Storage backends** | Amazon S3 · Google Cloud Storage · MinIO (switchable at runtime) |
| **Image processing** | Resize · Thumbnail · Format conversion · Watermark (ImageMagick) |
| **Video processing** | Probe · Thumbnail · Transcode · Clip · Audio extraction (FFmpeg) |
| **API** | RESTful JSON API with OpenAPI/Swagger docs |
| **Observability** | Structured JSON logging · `/health` · `/ready` · `/metrics` |
| **Security** | CORS · Request ID tracking · Auth placeholder (JWT-ready) |
| **Deployment** | Multi-stage Docker image · docker-compose for local dev |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FastAPI Application                   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  /api/v1/    │  │  /api/v1/    │  │  /api/v1/     │  │
│  │   files      │  │   images     │  │   videos      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                 │                  │           │
│  ┌──────▼─────────────────▼──────────────────▼────────┐  │
│  │              Dependency Injection Layer             │  │
│  └──────┬─────────────────┬──────────────────┬───────┘  │
│         │                 │                  │           │
│  ┌──────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐   │
│  │  Storage    │  │    Image     │  │    Video     │   │
│  │  Backend    │  │   Service    │  │   Service    │   │
│  │  (S3/GCS/   │  │(ImageMagick) │  │  (FFmpeg)   │   │
│  │   MinIO)    │  └──────────────┘  └──────────────┘   │
│  └─────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Location | Responsibility |
|---|---|---|
| **API** | `src/api/v1/routes/` | HTTP handling, request validation, response shaping |
| **Services** | `src/services/` | Business logic, orchestration, media processing |
| **Storage** | `src/services/storage/` | Backend-agnostic object I/O |
| **Core** | `src/core/` | Config, logging, exceptions |

---

## Quick Start

### Prerequisites

- Python 3.12+
- Docker & Docker Compose
- ImageMagick (`convert` binary)
- FFmpeg + FFprobe

### 1. Clone and configure

```bash
git clone <repo>
cd storage-service
cp .env.example .env
# Edit .env as needed
```

### 2. Start with Docker Compose (recommended)

```bash
docker compose up -d
```

This starts:
- **Storage Service** on `http://localhost:8000`
- **MinIO** on `http://localhost:9000` (S3 API) / `http://localhost:9001` (Console)

Open `http://localhost:8000/docs` for the interactive Swagger UI.

### 3. Run locally (without Docker)

```bash
# Install dependencies
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# Start MinIO (or point to your existing S3/GCS)
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Run the service
make run
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`.

### Storage backend selection

| Variable | Values | Default |
|---|---|---|
| `STORAGE_BACKEND` | `s3` · `gcs` · `minio` | `minio` |

### Amazon S3

```env
STORAGE_BACKEND=s3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
```

### Google Cloud Storage

```env
STORAGE_BACKEND=gcs
GCS_BUCKET=my-bucket
GCS_PROJECT_ID=my-project
GCS_CREDENTIALS_JSON=/secrets/service-account.json
```

### MinIO

```env
STORAGE_BACKEND=minio
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=storage-service
MINIO_SECURE=false
```

---

## API Reference

All routes are prefixed with `/api/v1`.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe (checks backend) |
| `GET` | `/metrics` | Basic service metrics |

### Files

| Method | Path | Description |
|---|---|---|
| `POST` | `/files/upload` | Upload any file |
| `GET` | `/files/{key}` | Download a file |
| `GET` | `/files/{key}/stat` | Object metadata |
| `POST` | `/files/{key}/presign` | Generate pre-signed URL |
| `DELETE` | `/files/{key}` | Delete an object |
| `GET` | `/files` | List objects (with `?prefix=` filter) |

**Upload example:**
```bash
curl -X POST http://localhost:8000/api/v1/files/upload \
  -F "file=@/path/to/document.pdf"
```

**Presign example:**
```bash
curl -X POST http://localhost:8000/api/v1/files/my-file.pdf/presign \
  -H "Content-Type: application/json" \
  -d '{"expires_in": 3600, "method": "GET"}'
```

### Images

| Method | Path | Description |
|---|---|---|
| `POST` | `/images/upload` | Upload an image |
| `GET` | `/images/{key}/info` | Probe image metadata |
| `POST` | `/images/{key}/resize` | Resize and store |
| `POST` | `/images/{key}/thumbnail` | Generate thumbnail |
| `POST` | `/images/{key}/convert` | Convert format |
| `POST` | `/images/{key}/watermark` | Apply watermark |

**Resize example:**
```bash
curl -X POST http://localhost:8000/api/v1/images/my-photo.jpg/resize \
  -H "Content-Type: application/json" \
  -d '{"width": 800, "height": 600, "output_format": "webp"}'
```

### Videos

| Method | Path | Description |
|---|---|---|
| `POST` | `/videos/upload` | Upload a video |
| `GET` | `/videos/{key}/info` | Probe video metadata |
| `GET` | `/videos/{key}/thumbnail` | Extract a frame as JPEG |
| `POST` | `/videos/{key}/transcode` | Transcode video |
| `POST` | `/videos/{key}/clip` | Cut a clip |
| `POST` | `/videos/{key}/extract-audio` | Strip audio track |

**Transcode example:**
```bash
curl -X POST http://localhost:8000/api/v1/videos/raw.mov/transcode \
  -H "Content-Type: application/json" \
  -d '{"output_format": "mp4", "video_codec": "libx264", "crf": 23, "preset": "fast"}'
```

---

## Testing

```bash
# All tests with coverage
make test

# Unit tests only
make test-unit

# Integration tests only (uses in-memory backend, no real storage needed)
make test-integration

# Without coverage report
make test-no-cov
```

---

## Development

```bash
# Lint
make lint

# Format
make format

# Type-check
make typecheck

# Security scan
make security
```

---

## Docker

```bash
# Build production image
make docker-build

# Start full stack
make docker-up

# Follow logs
make docker-logs

# Tear down
make docker-down
```

---

## Project Structure

```
storage-service/
├── src/
│   ├── api/
│   │   └── v1/
│   │       ├── dependencies.py      # FastAPI DI providers
│   │       ├── middleware.py        # Logging & exception middleware
│   │       └── routes/
│   │           ├── files.py         # File CRUD endpoints
│   │           ├── health.py        # Health / metrics endpoints
│   │           ├── images.py        # Image processing endpoints
│   │           └── videos.py        # Video processing endpoints
│   ├── core/
│   │   ├── config.py               # Pydantic Settings (env-driven)
│   │   ├── exceptions.py           # Domain exception hierarchy
│   │   └── logging.py              # structlog setup
│   ├── models/
│   │   └── schemas.py              # Pydantic request/response schemas
│   ├── services/
│   │   ├── image_service.py        # ImageMagick wrapper
│   │   ├── video_service.py        # FFmpeg / FFprobe wrapper
│   │   └── storage/
│   │       ├── base.py             # Abstract storage interface
│   │       ├── factory.py          # Backend factory
│   │       ├── s3_storage.py       # AWS S3 backend (aiobotocore)
│   │       ├── gcs_storage.py      # GCS backend (google-cloud-storage)
│   │       └── minio_storage.py    # MinIO backend (miniopy-async)
│   └── main.py                     # App factory & entry point
├── tests/
│   ├── conftest.py                 # Shared fixtures & in-memory backend
│   ├── unit/                       # Fast, pure unit tests
│   └── integration/                # Multi-component tests (no real backend)
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── Makefile
├── pyproject.toml
├── pytest.ini
├── requirements.txt
└── requirements-dev.txt
```

---

## Extending the service

### Adding a new storage backend

1. Create `src/services/storage/my_backend.py` implementing `BaseStorageBackend`.
2. Add a new entry to the `StorageBackend` enum in `src/core/config.py`.
3. Register it in `src/services/storage/factory.py`.

### Adding authentication

The `auth_enabled` flag and JWT fields in `Settings` are placeholders. To wire real auth:

1. Implement your token verifier in `src/core/auth.py`.
2. Add a `Depends(verify_token)` to sensitive route functions or use a router-level dependency.

---

## License

MIT
