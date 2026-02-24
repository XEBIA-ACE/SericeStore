# Storage Service

A production-ready, multi-cloud object storage service with media processing support.

**Storage backends:** Amazon S3 · Google Cloud Storage · MinIO
**Media processing:** ImageMagick (via sharp/libvips) · FFmpeg
**Runtime:** Node.js 20 · TypeScript · Express

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start (Docker)](#quick-start-docker)
- [Local Development](#local-development)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Storage Providers](#storage-providers)
- [Media Processing](#media-processing)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Deployment](#deployment)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Express App                          │
│                                                             │
│  Middlewares: helmet · cors · rate-limit · requestLogger    │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │   /v1/objects│   │   /health    │   │   /metrics     │  │
│  │  (CRUD API)  │   │  (readiness) │   │  (Prometheus)  │  │
│  └──────┬───────┘   └──────┬───────┘   └────────────────┘  │
│         │                  │                                 │
│  ┌──────▼───────────────────▼─────────────────────────────┐ │
│  │               Service Layer                            │ │
│  │  StorageService   HealthService   ImageProcessor       │ │
│  │                                  VideoProcessor        │ │
│  └──────┬──────────────────────────────────────────────── ┘ │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────────┐ │
│  │           Provider Abstraction (IStorageProvider)       │ │
│  │   S3Provider    GCSProvider    MinioProvider            │ │
│  └──────┬──────────────────────────────────────────────── ┘ │
└─────────┼───────────────────────────────────────────────────┘
          │
          ▼
   AWS S3 · Google Cloud Storage · MinIO
```

### Clean Architecture Layers

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| **API** | `src/api/` | HTTP controllers, route definitions, request validation, middleware |
| **Service** | `src/services/` | Business logic, orchestration, media processing |
| **Provider** | `src/providers/` | Cloud storage adapter implementations |
| **Core** | `src/core/` | Domain entities, port interfaces, error types |
| **Config** | `src/config/` | Validated environment configuration |
| **Utils** | `src/utils/` | Logging, key generation, temp file helpers |

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Docker & docker-compose** (for local development)
- **FFmpeg** (installed at `FFMPEG_PATH`, default `/usr/bin/ffmpeg`)
- **ImageMagick** (installed at `IMAGEMAGICK_PATH`, default `/usr/bin/convert`)

---

## Quick Start (Docker)

```bash
# Clone the repo and enter the directory
git clone <repo-url> storage-service
cd storage-service

# Start the full local stack (app + MinIO)
docker compose up --build

# The API is now available at http://localhost:3000
# MinIO console: http://localhost:9001  (user: minioadmin / pass: minioadmin)
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    Edit .env — set STORAGE_PROVIDER and provider credentials

# 3. Start MinIO locally (or skip if using S3/GCS)
docker compose up minio minio-setup -d

# 4. Run the development server (hot-reload)
npm run dev

# 5. Build for production
npm run build
npm start
```

---

## Configuration

All configuration is loaded from environment variables (see `.env.example`).

### Core Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development` / `staging` / `production` |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `STORAGE_PROVIDER` | `s3` | Active backend: `s3` / `gcs` / `minio` |
| `DEFAULT_BUCKET` | `storage-service-bucket` | Fallback bucket name |
| `PRESIGNED_URL_TTL_SECONDS` | `3600` | Default presigned URL expiry |

### AWS S3

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM access key (omit to use instance profile) |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `AWS_REGION` | AWS region |
| `AWS_S3_BUCKET` | S3 bucket name |
| `AWS_S3_ENDPOINT` | Custom endpoint (for S3-compatible APIs) |

### Google Cloud Storage

| Variable | Description |
|----------|-------------|
| `GCS_PROJECT_ID` | GCP project ID |
| `GCS_BUCKET` | GCS bucket name |
| `GCS_KEY_FILE` | Path to service-account JSON (omit to use ADC) |

### MinIO

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ENDPOINT` | `localhost` | MinIO host |
| `MINIO_PORT` | `9000` | MinIO port |
| `MINIO_ACCESS_KEY` | `minioadmin` | Access key |
| `MINIO_SECRET_KEY` | `minioadmin` | Secret key |
| `MINIO_BUCKET` | `storage-service` | Bucket name |
| `MINIO_USE_SSL` | `false` | Enable TLS |

### Media Processing

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_THUMBNAIL_WIDTH` | `320` | Thumbnail width px |
| `IMAGE_THUMBNAIL_HEIGHT` | `240` | Thumbnail height px |
| `IMAGE_QUALITY` | `85` | JPEG/WebP quality 1–100 |
| `VIDEO_OUTPUT_CODEC` | `libx264` | FFmpeg video codec |
| `VIDEO_OUTPUT_AUDIO_CODEC` | `aac` | FFmpeg audio codec |
| `FFMPEG_PATH` | `/usr/bin/ffmpeg` | Path to FFmpeg binary |

---

## API Reference

### Base URL

```
http://localhost:3000/v1
```

### Authentication

When `AUTH_ENABLED=true`, include a Bearer token in every request:

```
Authorization: Bearer <jwt-token>
```

---

### Upload a File

```http
POST /v1/objects
Content-Type: multipart/form-data
```

**Form fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `file` | Yes | File to upload |

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `processImage` | boolean | `false` | Resize image and generate thumbnail |
| `bucket` | string | — | Override the default bucket |

**Response `201`:**

```json
{
  "data": {
    "object": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "originalName": "photo.jpg",
      "key": "images/2024/04/550e8400-e29b-41d4-a716-446655440000.jpg",
      "bucket": "my-bucket",
      "contentType": "image/jpeg",
      "size": 245760,
      "provider": "s3",
      "metadata": {},
      "etag": "\"abc123\"",
      "createdAt": "2024-04-15T10:30:00.000Z",
      "updatedAt": "2024-04-15T10:30:00.000Z"
    },
    "presignedUrl": "https://...",
    "thumbnailPresignedUrl": "https://..."
  }
}
```

---

### List Objects

```http
GET /v1/objects?prefix=images/&maxKeys=50
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | string | — | Filter by key prefix |
| `maxKeys` | integer | `100` | Max results (1–1000) |
| `bucket` | string | — | Override bucket |

**Response `200`:**

```json
{
  "data": {
    "items": [
      {
        "key": "images/2024/04/photo.jpg",
        "size": 245760,
        "lastModified": "2024-04-15T10:30:00.000Z",
        "etag": "\"abc123\""
      }
    ],
    "count": 1
  }
}
```

---

### Get Presigned URL

```http
GET /v1/objects/:key/url?expiresIn=3600
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `key` | URL-encoded object key |

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | integer | `3600` | TTL in seconds (60–604800) |
| `bucket` | string | — | Override bucket |

**Response `200`:**

```json
{
  "data": {
    "key": "images/2024/04/photo.jpg",
    "url": "https://..."
  }
}
```

---

### Download Object

```http
GET /v1/objects/:key/download
```

Returns the raw file bytes with appropriate `Content-Type` and `Content-Disposition` headers.

---

### Delete Object

```http
DELETE /v1/objects/:key
```

**Response `204 No Content`**

---

### Copy Object

```http
POST /v1/objects/copy
Content-Type: application/json
```

**Request body:**

```json
{
  "sourceKey": "images/original.jpg",
  "destKey": "images/copy.jpg",
  "sourceBucket": "bucket-a",
  "destBucket": "bucket-b"
}
```

**Response `201`:**

```json
{
  "data": {
    "sourceKey": "images/original.jpg",
    "destKey": "images/copy.jpg",
    "message": "Object copied successfully"
  }
}
```

---

### Health & Observability

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Full readiness check (storage connectivity) |
| `GET /health/live` | Liveness ping (no external I/O) |
| `GET /metrics` | Prometheus metrics scrape endpoint |

**Health response:**

```json
{
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "uptime": 3600,
    "timestamp": "2024-04-15T10:30:00.000Z",
    "checks": {
      "storage.s3": { "status": "pass", "latencyMs": 12 }
    }
  }
}
```

---

### Error Format

All errors follow a consistent JSON envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "destKey", "message": "\"destKey\" is required" }
    ],
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | `VALIDATION_ERROR` | Invalid request parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid auth token |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Object or route not found |
| 413 | `FILE_TOO_LARGE` | File exceeds size limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME type not allowed |
| 422 | `MEDIA_PROCESSING_ERROR` | Image/video processing failed |
| 502 | `STORAGE_ERROR` | Cloud storage backend error |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Storage Providers

### Switching Providers

Change `STORAGE_PROVIDER` in `.env` and restart the service. No code changes required.

### Amazon S3

Supports IAM roles (recommended for EC2/ECS/Lambda) or explicit key/secret.
Also works with S3-compatible APIs (Cloudflare R2, Backblaze B2, etc.) via `AWS_S3_ENDPOINT`.

### Google Cloud Storage

Supports Application Default Credentials (recommended) or an explicit service-account key file.

### MinIO

Ideal for local development and on-premise deployments. The bundled `docker-compose.yml`
spins up a MinIO instance automatically.

---

## Media Processing

### Images (sharp / libvips)

When `processImage=true` is passed on upload:

1. The image is optionally resized (fit: inside, no upscaling).
2. A JPEG thumbnail (`IMAGE_THUMBNAIL_WIDTH × IMAGE_THUMBNAIL_HEIGHT`) is generated.
3. Both the processed image and thumbnail are stored in the configured bucket.
4. Presigned URLs for both are returned in the upload response.

### Videos (FFmpeg)

Video transcoding is available via `VideoProcessor` in `src/services/media/VideoProcessor.ts`.
To trigger it, call the processor from your own extension of `StorageService` or add a
dedicated `/v1/videos/transcode` endpoint that:

1. Downloads the source video to a temp file.
2. Calls `VideoProcessor.transcode()`.
3. Uploads the result and returns a presigned URL.

---

## Testing

```bash
# All tests with coverage
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration
```

### Test layout

```
tests/
├── unit/
│   ├── services/
│   │   ├── StorageService.test.ts   # Business logic (mocked provider)
│   │   └── ImageProcessor.test.ts  # Image processing (mocked sharp)
│   └── providers/
│       └── S3Provider.test.ts       # Provider adapter
└── integration/
    └── api.test.ts                  # Full HTTP layer (mocked service)
```

---

## Project Structure

```
storage-service/
├── src/
│   ├── api/
│   │   ├── controllers/        # HTTP request/response handlers
│   │   ├── middlewares/        # auth, errorHandler, requestLogger, upload
│   │   ├── routes/             # Express Router definitions
│   │   └── validators/         # Joi schema validators
│   ├── core/
│   │   ├── entities/           # Domain entities (StoredObject, …)
│   │   ├── interfaces/         # Port interfaces (IStorageProvider, …)
│   │   └── errors/             # Typed error classes
│   ├── services/
│   │   ├── storage/            # StorageService (orchestration)
│   │   ├── media/              # ImageProcessor, VideoProcessor
│   │   └── health/             # HealthService
│   ├── providers/
│   │   ├── s3/                 # AWS S3 adapter
│   │   ├── gcs/                # Google Cloud Storage adapter
│   │   ├── minio/              # MinIO adapter
│   │   └── StorageProviderFactory.ts
│   ├── config/                 # Environment configuration
│   ├── utils/                  # logger, keyGenerator, tempFile
│   ├── app.ts                  # Express app factory (composition root)
│   └── index.ts                # Server entry point
├── tests/
│   ├── unit/                   # Fast, isolated unit tests
│   └── integration/            # HTTP-level integration tests
├── docs/                       # Additional documentation
├── Dockerfile                  # Multi-stage production image
├── docker-compose.yml          # Local development stack
├── package.json
├── tsconfig.json
├── jest.config.js
├── .env.example
└── README.md
```

---

## Deployment

### Docker

```bash
# Build production image
docker build --target runtime -t storage-service:latest .

# Run
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  storage-service:latest
```

### Environment-specific configuration

| Environment | `NODE_ENV` | Notes |
|-------------|-----------|-------|
| Development | `development` | Colorized logs, AUTH_ENABLED=false |
| Staging | `staging` | JSON logs, real provider |
| Production | `production` | JSON logs, AUTH_ENABLED=true |

### Kubernetes (example)

```yaml
# ConfigMap for non-sensitive config, Secret for credentials
# Liveness probe: GET /health/live
# Readiness probe: GET /health
# Resources: requests cpu=100m memory=256Mi, limits cpu=500m memory=512Mi
```

### Prometheus scraping

Add an annotation to your pod:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "3000"
  prometheus.io/path: "/metrics"
```

---

## License

MIT
