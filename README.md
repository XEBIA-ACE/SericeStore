# Storage Service

A production-ready, multi-cloud object storage service with integrated media processing. Supports **Amazon S3**, **Google Cloud Storage**, and **MinIO** as interchangeable backends, with **ImageMagick** for image transformations and **FFmpeg** for video/audio processing.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start (Local)](#quick-start-local)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Media Processing](#media-processing)
- [Running Tests](#running-tests)
- [Docker](#docker)
- [Switching Storage Backends](#switching-storage-backends)
- [Observability](#observability)
- [Project Structure](#project-structure)

---

## Features

| Category | Details |
|---|---|
| **Storage** | Amazon S3, Google Cloud Storage, MinIO (pluggable via env var) |
| **Image processing** | Resize, crop, rotate, flip, format conversion, greyscale (ImageMagick) |
| **Video processing** | Transcode, thumbnail extraction, metadata probe (FFmpeg) |
| **API** | RESTful JSON API with OpenAPI / Swagger docs |
| **Auth** | Bearer-token guard (plug in JWT / OAuth as needed) |
| **Observability** | Structured Winston logging, Prometheus metrics, health endpoints |
| **Security** | Helmet headers, CORS, rate limiting, MIME-type allow-listing |
| **DX** | TypeScript strict mode, ESLint, Prettier, Jest, hot-reload in dev |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     HTTP Layer                      │
│  Express + Helmet + CORS + Rate Limit + Morgan      │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                   API Layer                         │
│  Routes → Controllers (Storage | Media | Health)   │
└────────┬──────────────────────────┬─────────────────┘
         │                          │
┌────────▼──────────┐   ┌──────────▼──────────────────┐
│  StorageService   │   │    Media Processing          │
│  (key generation, │   │  ImageProcessingService      │
│   metrics, DL/UL) │   │  VideoProcessingService      │
└────────┬──────────┘   │  (ImageMagick / FFmpeg)      │
         │              └─────────────────────────────┘
┌────────▼──────────────────────────────────────────┐
│             Storage Provider Adapters             │
│   S3StorageProvider  |  GCSStorageProvider        │
│   MinIOStorageProvider (wraps S3 w/ path-style)   │
└───────────────────────────────────────────────────┘
```

**Clean Architecture layers:**
- **API** — HTTP concerns only (routing, request parsing, response serialisation)
- **Services** — Business logic (StorageService, ImageProcessingService, VideoProcessingService)
- **Providers** — External I/O adapters (S3, GCS, MinIO)
- **Core** — Shared interfaces, types, and errors (no external dependencies)

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 18.x | LTS recommended |
| npm | 9.x | Comes with Node |
| ImageMagick | 7.x | `brew install imagemagick` / `apt install imagemagick` |
| FFmpeg | 6.x | `brew install ffmpeg` / `apt install ffmpeg` |
| Docker + Compose | 24.x / 2.x | For containerised local dev |

---

## Quick Start (Local)

```bash
# 1. Clone and install
git clone <repo-url> storage-service
cd storage-service
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set API_SECRET_KEY and choose STORAGE_PROVIDER

# 3. Start MinIO locally (or configure S3/GCS credentials)
docker compose up minio minio-init -d

# 4. Run in development mode (hot-reload)
npm run dev
```

The API is now available at `http://localhost:3000/api/v1`.
Swagger UI: `http://localhost:3000/api/v1/docs`

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the values.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `staging` \| `production` \| `test` |
| `PORT` | `3000` | HTTP server port |
| `API_SECRET_KEY` | *(required)* | Bearer token for API authentication |
| `STORAGE_PROVIDER` | `minio` | `s3` \| `gcs` \| `minio` |
| `MAX_FILE_SIZE` | `524288000` | Upload size limit in bytes (500 MB) |
| `ALLOWED_MIME_TYPES` | `*` | Comma-separated MIME types or `*` for all |
| `TEMP_DIR` | `/tmp/storage-service` | Temp directory for media processing |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `http` \| `debug` |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |

See `.env.example` for the full list including provider-specific variables.

---

## API Reference

> Full interactive docs: `GET /api/v1/docs`

### Authentication

All storage and media endpoints require:

```
Authorization: Bearer <API_SECRET_KEY>
```

### Storage Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/storage` | List objects (supports `prefix`, `cursor`, `limit`) |
| `POST` | `/api/v1/storage/upload` | Upload a file (`multipart/form-data`, field: `file`) |
| `GET` | `/api/v1/storage/:key` | Download a file (streams the body) |
| `GET` | `/api/v1/storage/:key/metadata` | Get object metadata |
| `GET` | `/api/v1/storage/:key/presign` | Generate a pre-signed URL |
| `POST` | `/api/v1/storage/:key/copy` | Copy an object |
| `DELETE` | `/api/v1/storage/:key` | Delete an object |

#### Upload example

```bash
curl -X POST http://localhost:3000/api/v1/storage/upload \
  -H "Authorization: Bearer your-secret" \
  -F "file=@/path/to/photo.jpg" \
  -F "prefix=avatars"
```

#### List objects

```bash
curl "http://localhost:3000/api/v1/storage?prefix=avatars&limit=20" \
  -H "Authorization: Bearer your-secret"
```

### Health Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness probe |
| `GET` | `/api/v1/health/ready` | Readiness probe |
| `GET` | `/metrics` | Prometheus metrics |

---

## Media Processing

### Image Transform

```bash
curl -X POST http://localhost:3000/api/v1/media/image/transform \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceKey": "avatars/2024/01/01/original.jpg",
    "width": 400,
    "height": 400,
    "fit": "cover",
    "format": "webp",
    "quality": 85,
    "outputPrefix": "avatars/thumbs"
  }'
```

Supported `fit` modes: `cover` | `contain` | `fill` | `inside` | `outside`
Supported output `format`: `jpeg` | `png` | `webp` | `gif` | `tiff`

### Image Metadata

```bash
curl "http://localhost:3000/api/v1/media/image/metadata?key=avatars/photo.jpg" \
  -H "Authorization: Bearer your-secret"
```

### Video Transcode

```bash
curl -X POST http://localhost:3000/api/v1/media/video/transcode \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceKey": "videos/raw/input.mov",
    "format": "mp4",
    "videoCodec": "libx264",
    "audioCodec": "aac",
    "videoBitrate": "1000k",
    "width": 1280,
    "height": 720
  }'
```

### Video Thumbnail

```bash
curl -X POST http://localhost:3000/api/v1/media/video/thumbnail \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceKey": "videos/clip.mp4",
    "timestamp": 5,
    "width": 640,
    "format": "jpeg"
  }'
```

### Video Metadata

```bash
curl "http://localhost:3000/api/v1/media/video/metadata?key=videos/clip.mp4" \
  -H "Authorization: Bearer your-secret"
```

---

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm run test:coverage
```

Tests use Jest with mocked storage providers and media binaries — **no cloud credentials or installed binaries needed**.

---

## Docker

### Run with Docker Compose (recommended for local dev)

```bash
# Start everything (API + MinIO)
docker compose up --build -d

# With Prometheus monitoring
docker compose --profile monitoring up -d

# View logs
docker compose logs -f storage-service

# Stop
docker compose down
```

### Build image only

```bash
docker build -t storage-service:latest .
docker run -p 3000:3000 --env-file .env storage-service:latest
```

---

## Switching Storage Backends

Change `STORAGE_PROVIDER` in `.env` and supply the corresponding credentials:

**Amazon S3**
```dotenv
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=my-bucket
```

**Google Cloud Storage**
```dotenv
STORAGE_PROVIDER=gcs
GCS_PROJECT_ID=my-project
GCS_BUCKET=my-bucket
GCS_KEY_FILE=./credentials/gcs-service-account.json
```

**MinIO (default)**
```dotenv
STORAGE_PROVIDER=minio
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=storage-service
```

No application code changes are required — the factory selects the correct adapter automatically.

---

## Observability

### Prometheus metrics

Available at `GET /metrics` (protected at network level — not behind auth middleware).

Key metrics:

| Metric | Type | Labels |
|---|---|---|
| `storage_service_http_requests_total` | Counter | `method`, `route`, `status_code` |
| `storage_service_http_request_duration_ms` | Histogram | `method`, `route`, `status_code` |
| `storage_service_bytes_uploaded_total` | Counter | `provider` |
| `storage_service_bytes_downloaded_total` | Counter | `provider` |
| `storage_service_media_processing_total` | Counter | `type`, `status` |
| `storage_service_media_processing_duration_ms` | Histogram | `type` |

### Logging

Structured JSON logs via Winston. Every log entry includes `service`, `level`, and `timestamp`.
Set `LOG_FORMAT=simple` for human-readable console output during local development.

---

## Project Structure

```
storage-service/
├── src/
│   ├── index.ts                        # Entry point & graceful shutdown
│   ├── app.ts                          # Express app factory + DI wiring
│   ├── config/
│   │   └── index.ts                    # Zod-validated env config
│   ├── core/
│   │   ├── errors/AppError.ts          # Typed error hierarchy
│   │   ├── interfaces/
│   │   │   ├── IStorageProvider.ts     # Storage adapter contract
│   │   │   └── IMediaProcessor.ts      # Media processor contracts
│   │   └── types/index.ts              # Shared TypeScript types
│   ├── services/
│   │   ├── storage/
│   │   │   ├── StorageService.ts       # High-level storage operations
│   │   │   ├── StorageProviderFactory.ts
│   │   │   └── providers/
│   │   │       ├── S3StorageProvider.ts
│   │   │       ├── GCSStorageProvider.ts
│   │   │       └── MinIOStorageProvider.ts
│   │   └── media/
│   │       ├── ImageProcessingService.ts   # ImageMagick via gm
│   │       └── VideoProcessingService.ts   # FFmpeg via fluent-ffmpeg
│   ├── api/
│   │   ├── controllers/
│   │   │   ├── StorageController.ts
│   │   │   ├── MediaController.ts
│   │   │   └── HealthController.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   ├── logger.middleware.ts
│   │   │   ├── requestId.middleware.ts
│   │   │   └── upload.middleware.ts
│   │   └── routes/
│   │       ├── index.ts                # Router factory + Swagger setup
│   │       ├── health.routes.ts
│   │       ├── storage.routes.ts
│   │       └── media.routes.ts
│   └── utils/
│       ├── logger.ts                   # Winston logger
│       └── metrics.ts                  # Prometheus client
├── tests/
│   ├── unit/
│   │   └── services/
│   │       ├── storage/StorageService.test.ts
│   │       └── media/
│   │           ├── ImageProcessingService.test.ts
│   │           └── VideoProcessingService.test.ts
│   └── integration/
│       └── api/
│           ├── health.test.ts
│           └── storage.test.ts
├── docker/
│   └── prometheus.yml
├── Dockerfile
├── docker-compose.yml
├── jest.config.ts
├── tsconfig.json
├── .env.example
└── README.md
```

---

## License

MIT
