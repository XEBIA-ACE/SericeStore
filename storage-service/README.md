# SericeStore

A production-ready **Storage & Media Processing Service** built with FastAPI, supporting **Amazon S3**, **Google Cloud Storage**, **MinIO**, **ImageMagick**, and **FFmpeg**.

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Development](#development)
- [Testing](#testing)
- [Docker](#docker)
- [Project Structure](#project-structure)

---

## Architecture

SericeStore follows **Clean Architecture** with strict layer separation:

```
┌───────────────────────────────────────────────────────┐
│                     API Layer                         │
│  FastAPI routes · Pydantic schemas · Middleware       │
├───────────────────────────────────────────────────────┤
│                  Service Layer                        │
│  FileService · MediaService  (business logic)        │
├───────────────────────────────────────────────────────┤
│                  Domain Layer                         │
│  StoredFile · ProcessingJob · StorageRepository (ABC)│
├───────────────────────────────────────────────────────┤
│               Infrastructure Layer                    │
│  S3Storage · GCSStorage · MinIOStorage               │
│  ImageProcessor (Wand/ImageMagick)                   │
│  VideoProcessor (FFmpeg)                              │
└───────────────────────────────────────────────────────┘
```

The storage backend is selected at runtime via the `STORAGE_BACKEND` environment variable. Switching from MinIO (local dev) to S3 (production) requires only a config change — no code changes.

---

## Features

| Category | Capability |
|---|---|
| **Storage** | Upload, download, stream, delete, list with prefix/pagination |
| **Presigned URLs** | Client-side upload & download without routing through the API |
| **Image Processing** | Resize, thumbnail, crop, rotate, flip, grayscale, watermark, format convert, EXIF extraction |
| **Video Processing** | Transcode, frame extraction, audio extraction, animated GIF creation, FFprobe metadata |
| **Observability** | Structured JSON logging (structlog), `/health`, `/health/ready`, `/metrics` |
| **Security** | Bearer token auth (pluggable), input validation, object key sanitization, size limits |
| **Multi-environment** | dev / staging / production via env vars |

---

## Quick Start

### Local development with Docker Compose

```bash
# 1. Clone the repository
git clone https://github.com/your-org/sericestore.git
cd sericestore

# 2. Start MinIO + the API
docker compose -f docker/docker-compose.yml up --build

# 3. API is available at http://localhost:8000
#    MinIO console at  http://localhost:9001  (user: minioadmin / minioadmin)
#    Swagger UI at     http://localhost:8000/docs
```

### Local development without Docker

```bash
# Prerequisites: Python 3.12+, ImageMagick, FFmpeg

# 1. Install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

# 2. Configure environment
cp .env.example .env
# Edit .env: set STORAGE_BACKEND=minio and point MINIO_* vars at a running MinIO

# 3. Run the server
python main.py
```

---

## Configuration

All configuration is via environment variables (see `.env.example` for the full list).

| Variable | Default | Description |
|---|---|---|
| `STORAGE_BACKEND` | `s3` | Active backend: `s3` \| `gcs` \| `minio` |
| `AWS_S3_BUCKET` | — | S3 bucket name |
| `AWS_REGION` | `us-east-1` | AWS region |
| `GCS_PROJECT_ID` | — | GCP project ID |
| `GCS_BUCKET` | — | GCS bucket name |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO host:port |
| `MINIO_BUCKET` | `sericestore` | MinIO bucket |
| `MAX_UPLOAD_SIZE_MB` | `500` | Per-file upload limit |
| `THUMBNAIL_WIDTH` | `300` | Default thumbnail width (px) |
| `THUMBNAIL_HEIGHT` | `300` | Default thumbnail height (px) |
| `IMAGE_QUALITY_DEFAULT` | `85` | JPEG/WebP output quality |
| `VIDEO_CRF_DEFAULT` | `23` | FFmpeg CRF (lower = better quality) |
| `AUTH_ENABLED` | `false` | Enable Bearer token auth |
| `AUTH_SECRET_KEY` | — | Token secret (required if auth enabled) |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARNING` \| `ERROR` |
| `ENVIRONMENT` | `development` | `development` \| `staging` \| `production` |

---

## API Reference

Interactive documentation is available at `/docs` (Swagger) and `/redoc`.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (checks storage backend) |
| `GET` | `/metrics` | Basic application metrics |

### Files  `prefix: /api/v1`

| Method | Path | Description |
|---|---|---|
| `POST` | `/files/upload` | Upload a file (multipart/form-data) |
| `POST` | `/files/upload-url` | Generate a presigned upload URL |
| `GET` | `/files` | List files (supports `prefix`, `max_keys`, `continuation_token`) |
| `GET` | `/files/{key}` | Download a file |
| `HEAD` | `/files/{key}` | Get file metadata |
| `GET` | `/files/{key}/url` | Generate a presigned download URL |
| `DELETE` | `/files/{key}` | Delete a file |

#### Upload example

```bash
curl -X POST http://localhost:8000/api/v1/files/upload \
  -F "file=@photo.jpg;type=image/jpeg" \
  -F "prefix=avatars"
```

#### Response

```json
{
  "id": "3f9a7b20-...",
  "key": "avatars/3f9a7b20-.../photo.jpg",
  "bucket": "sericestore",
  "backend": "minio",
  "content_type": "image/jpeg",
  "size_bytes": 204800,
  "original_filename": "photo.jpg",
  "etag": "abc123",
  "created_at": "2026-02-24T10:00:00Z",
  "metadata": {}
}
```

### Media Processing  `prefix: /api/v1`

#### Images

| Method | Path | Description |
|---|---|---|
| `POST` | `/media/images/resize` | Resize an image |
| `POST` | `/media/images/thumbnail` | Create a thumbnail |
| `POST` | `/media/images/convert` | Convert image format |
| `POST` | `/media/images/crop` | Crop an image |
| `POST` | `/media/images/watermark` | Apply watermark |
| `GET` | `/media/images/{key}/metadata` | Extract image metadata (EXIF, dimensions…) |

#### Image resize example

```bash
curl -X POST http://localhost:8000/api/v1/media/images/resize \
  -H "Content-Type: application/json" \
  -d '{
    "source_key": "avatars/uuid/photo.jpg",
    "width": 800,
    "height": 600,
    "maintain_aspect": true,
    "output_format": "webp",
    "quality": 80
  }'
```

#### Videos

| Method | Path | Description |
|---|---|---|
| `POST` | `/media/videos/transcode` | Transcode to a different codec/format |
| `POST` | `/media/videos/frame` | Extract a frame as JPEG |
| `POST` | `/media/videos/audio` | Extract the audio track |
| `POST` | `/media/videos/gif` | Create an animated GIF from a segment |
| `GET` | `/media/videos/{key}/metadata` | Extract video metadata (FFprobe) |

#### Transcode example

```bash
curl -X POST http://localhost:8000/api/v1/media/videos/transcode \
  -H "Content-Type: application/json" \
  -d '{
    "source_key": "videos/uuid/clip.mov",
    "output_format": "mp4",
    "video_codec": "libx264",
    "audio_codec": "aac",
    "crf": 23,
    "preset": "fast",
    "width": 1280
  }'
```

---

## Development

### Code style

```bash
# Lint & format
ruff check .
ruff format .

# Type checking
mypy src/
```

### Adding a new storage backend

1. Create `src/infrastructure/storage/my_backend.py` implementing `StorageRepository`.
2. Add a new value to `StorageBackend` in `src/core/config.py`.
3. Register it in `src/infrastructure/storage/__init__.py`'s factory.
4. Add the relevant env vars to `.env.example`.

---

## Testing

```bash
# Run all tests
pytest

# Unit tests only (no external services required)
pytest tests/unit/

# Integration tests (requires running docker compose stack)
pytest tests/integration/

# With coverage report
pytest --cov=src --cov-report=term-missing
```

---

## Docker

### Build the image

```bash
docker build -f docker/Dockerfile -t sericestore:latest .
```

### Run with S3

```bash
docker run -p 8000:8000 \
  -e STORAGE_BACKEND=s3 \
  -e AWS_ACCESS_KEY_ID=your_key \
  -e AWS_SECRET_ACCESS_KEY=your_secret \
  -e AWS_S3_BUCKET=your-bucket \
  -e AWS_REGION=us-east-1 \
  sericestore:latest
```

### Run with GCS

```bash
docker run -p 8000:8000 \
  -e STORAGE_BACKEND=gcs \
  -e GCS_PROJECT_ID=my-project \
  -e GCS_BUCKET=my-bucket \
  -v /path/to/credentials.json:/app/credentials.json:ro \
  -e GCS_CREDENTIALS_FILE=/app/credentials.json \
  sericestore:latest
```

---

## Project Structure

```
storage-service/
├── src/
│   ├── api/
│   │   ├── middleware/
│   │   │   ├── auth.py          # Bearer token auth (pluggable)
│   │   │   └── logging.py       # Structured request/response logging
│   │   ├── routes/
│   │   │   ├── files.py         # File CRUD + presigned URL endpoints
│   │   │   ├── health.py        # Health & metrics endpoints
│   │   │   └── media.py         # Image & video processing endpoints
│   │   └── schemas/
│   │       ├── file.py          # File request/response Pydantic models
│   │       └── media.py         # Media request/response Pydantic models
│   ├── core/
│   │   ├── config.py            # Settings (pydantic-settings)
│   │   ├── exceptions.py        # Domain exceptions
│   │   └── logging.py           # structlog setup
│   ├── domain/
│   │   ├── models/
│   │   │   ├── file.py          # StoredFile dataclass
│   │   │   └── media.py         # ImageMetadata, VideoMetadata, ProcessingJob
│   │   └── repositories/
│   │       └── storage_repository.py  # StorageRepository ABC
│   ├── infrastructure/
│   │   ├── storage/
│   │   │   ├── __init__.py      # Backend factory (get_storage_backend)
│   │   │   ├── base.py          # Shared utilities (sanitize_key, etc.)
│   │   │   ├── s3_storage.py    # AWS S3 adapter (aioboto3)
│   │   │   ├── gcs_storage.py   # GCS adapter (google-cloud-storage)
│   │   │   └── minio_storage.py # MinIO adapter (miniopy-async)
│   │   └── media/
│   │       ├── __init__.py      # Processor factories
│   │       ├── image_processor.py  # ImageMagick/Wand operations
│   │       └── video_processor.py  # FFmpeg operations
│   └── services/
│       ├── file_service.py      # File upload/download/list/delete logic
│       └── media_service.py     # Orchestrates media transformations
├── tests/
│   ├── conftest.py              # Shared fixtures (InMemoryStorage, etc.)
│   ├── unit/
│   │   ├── test_file_service.py
│   │   └── test_storage_base.py
│   └── integration/
│       └── test_api_files.py
├── docker/
│   ├── Dockerfile               # Multi-stage build (builder + runtime)
│   └── docker-compose.yml       # Full local stack (API + MinIO)
├── main.py                      # FastAPI app factory & entry point
├── requirements.txt
├── requirements-dev.txt
├── pytest.ini
├── .env.example
├── .gitignore
└── README.md
```
