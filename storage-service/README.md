# SericeStore — Storage Service

A production-ready, multi-cloud file storage service with image and video processing pipelines, built with Node.js and TypeScript.

---

## Features

| Feature | Details |
|---|---|
| **Multi-cloud storage** | Amazon S3, Google Cloud Storage, MinIO (switch via env var) |
| **Image processing** | Resize, thumbnail generation, format conversion, EXIF stripping via ImageMagick |
| **Video processing** | Thumbnail extraction, MP4 transcoding, metadata probing via FFmpeg |
| **REST API** | Express with OpenAPI/Swagger docs at `/api/docs` |
| **Auth** | JWT Bearer token middleware (pluggable identity provider) |
| **Observability** | Structured Winston logging, Prometheus metrics at `/metrics`, health probes |
| **Rate limiting** | Configurable via env vars |
| **Docker** | Multi-stage Dockerfile; docker-compose with MinIO, Prometheus, Grafana |
| **Tests** | Jest unit + supertest integration tests |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  HTTP Clients               │
└───────────────────┬─────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │   Express App       │  src/app.ts
         │  (helmet, cors,     │
         │   rate-limit, jwt)  │
         └──────────┬──────────┘
                    │
    ┌───────────────▼──────────────────┐
    │        API Layer                 │  src/api/
    │  routes/ controllers/ middleware/ │
    └───────────────┬──────────────────┘
                    │
    ┌───────────────▼──────────────────┐
    │      FileService                 │  src/services/file.service.ts
    │  (orchestrates all pipelines)    │
    └──────┬────────────┬──────────────┘
           │            │
  ┌────────▼──┐   ┌─────▼──────────────────┐
  │ Storage   │   │  Processing            │
  │ Provider  │   │  ImageProcessor (gm)   │
  │ (S3/GCS/  │   │  VideoProcessor (ffmpeg│
  │  MinIO)   │   └────────────────────────┘
  └───────────┘
```

### Directory Structure

```
storage-service/
├── src/
│   ├── api/
│   │   ├── controllers/          # HTTP handlers (thin adapters)
│   │   │   ├── files.controller.ts
│   │   │   └── health.controller.ts
│   │   ├── middleware/           # auth, error, upload, request-id
│   │   ├── routes/               # Express routers
│   │   └── swagger.ts            # OpenAPI spec generator
│   ├── config/                   # Centralised env-var configuration
│   ├── core/
│   │   ├── interfaces/           # IStorageProvider, IImageProcessor, IVideoProcessor
│   │   └── types/                # Domain types (FileMetadata, ApiResponse, etc.)
│   ├── services/
│   │   ├── file.service.ts       # Business-logic orchestrator
│   │   ├── storage/              # S3, GCS, MinIO providers + factory
│   │   └── processing/           # ImageProcessor, VideoProcessor
│   └── utils/                    # Logger, validators, domain errors
├── tests/
│   ├── unit/                     # Jest unit tests (no I/O)
│   └── integration/              # Supertest HTTP tests (providers mocked)
├── docker/
│   └── prometheus.yml
├── Dockerfile                    # Multi-stage build
├── docker-compose.yml            # Local dev stack
└── .env.example
```

---

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **Docker** + **Docker Compose** (for local stack)
- **ImageMagick** (`convert`) — required if `ENABLE_IMAGE_PROCESSING=true`
- **FFmpeg** — required if `ENABLE_VIDEO_PROCESSING=true`

### 1 — Clone and install

```bash
git clone <repo-url>
cd storage-service
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3a — Local stack with Docker Compose (recommended)

Starts the API, MinIO, Prometheus, and Grafana in one command:

```bash
docker-compose up --build
```

| Service | URL |
|---|---|
| Storage Service API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/api/docs |
| MinIO Console | http://localhost:9001 (minioadmin / minioadmin) |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin) |

### 3b — Run locally (development mode)

```bash
# Ensure MinIO or another provider is running and configured in .env
npm run dev
```

### Build for production

```bash
npm run build
npm start
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list with descriptions.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `STORAGE_PROVIDER` | `minio` | Active backend: `s3`, `gcs`, or `minio` |
| `AUTH_ENABLED` | `true` | Set to `false` to skip JWT validation (dev only) |
| `JWT_SECRET` | — | Secret for JWT signing; **required in production** |
| `MAX_FILE_SIZE_MB` | `100` | Maximum upload size in MB |
| `ENABLE_IMAGE_PROCESSING` | `true` | Toggle ImageMagick pipeline |
| `ENABLE_VIDEO_PROCESSING` | `true` | Toggle FFmpeg pipeline |

---

## API Reference

Interactive documentation is available at `/api/docs` when the service is running.

### Base URL

```
http://localhost:3000/api/v1
```

### Authentication

Include a Bearer JWT in every request (unless `AUTH_ENABLED=false`):

```
Authorization: Bearer <token>
```

---

### Endpoints

#### Upload a File

```
POST /api/v1/files
Content-Type: multipart/form-data
```

**Form fields:**

| Field | Type | Description |
|---|---|---|
| `file` | binary | The file to upload (required) |
| `processMedia` | boolean | Run image/video processing (default: `true`) |
| `tags` | string | JSON-encoded `{"key": "value"}` tags |

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "originalName": "photo.jpg",
    "key": "images/f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg",
    "mimeType": "image/jpeg",
    "size": 204800,
    "category": "image",
    "bucket": "storage-service",
    "provider": "minio",
    "uploadedAt": "2024-07-01T12:00:00.000Z",
    "processing": {
      "status": "completed",
      "thumbnailKey": "images/f47ac10b-...-thumb.jpg",
      "thumbnailUrl": "https://...",
      "width": 1920,
      "height": 1080
    }
  },
  "meta": { "requestId": "...", "timestamp": "...", "version": "1.0.0" }
}
```

---

#### List Files

```
GET /api/v1/files?prefix=images/&maxKeys=50&continuationToken=<token>
```

**Response `200`:**

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": { "hasMore": false, "nextToken": null }
}
```

---

#### Download a File

```
GET /api/v1/files/:key
```

Returns the file as a binary stream with `Content-Disposition: attachment`.

---

#### Get Presigned URL

```
GET /api/v1/files/:key/url?expiresIn=3600
```

**Response `200`:**

```json
{
  "success": true,
  "data": { "url": "https://...", "expiresIn": 3600 }
}
```

---

#### Get File Metadata

```
GET /api/v1/files/:key/metadata
```

Returns storage metadata without downloading the file body.

---

#### Copy a File

```
POST /api/v1/files/:key/copy
Content-Type: application/json

{ "destinationKey": "archive/photo.jpg" }
```

---

#### Delete a File

```
DELETE /api/v1/files/:key
```

---

#### Batch Delete

```
DELETE /api/v1/files
Content-Type: application/json

{ "keys": ["images/a.jpg", "images/b.jpg"] }
```

---

### Health & Observability

| Endpoint | Description |
|---|---|
| `GET /health/live` | Liveness probe — always 200 while process runs |
| `GET /health/ready` | Readiness probe — checks storage + processors |
| `GET /metrics` | Prometheus metrics (text format) |

---

## Storage Providers

### Amazon S3

```env
STORAGE_PROVIDER=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=my-bucket
```

For LocalStack, also set `AWS_S3_ENDPOINT=http://localhost:4566`.

### Google Cloud Storage

```env
STORAGE_PROVIDER=gcs
GCS_PROJECT_ID=my-gcp-project
GCS_BUCKET=my-bucket
GCS_KEY_FILE=./config/gcs-key.json
```

### MinIO (default)

```env
STORAGE_PROVIDER=minio
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=storage-service
```

---

## Testing

```bash
# All tests
npm test

# Unit tests only (no I/O)
npm run test:unit

# Integration tests (providers mocked)
npm run test:integration

# Coverage report
npm run test:coverage
```

---

## Docker

### Build image

```bash
docker build -t storage-service:latest .
```

### Run standalone

```bash
docker run -p 3000:3000 \
  -e STORAGE_PROVIDER=minio \
  -e MINIO_ENDPOINT=host.docker.internal \
  -e AUTH_ENABLED=false \
  storage-service:latest
```

---

## Security Notes

- All secrets must be provided via environment variables — never hard-coded.
- Object keys are sanitised to prevent path traversal.
- MIME types are validated against a configurable allowlist before upload.
- JWT authentication is enforced by default; disable only for local development.
- The production Docker image runs as a non-root user (`appuser`).
- Rate limiting is applied globally; tune `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` for your traffic profile.

---

## Extending the Service

### Adding a new storage provider

1. Create `src/services/storage/mycloud.provider.ts` implementing `IStorageProvider`.
2. Register it in `src/services/storage/storage.factory.ts`.
3. Add the corresponding config block to `src/config/index.ts` and `.env.example`.

### Customising image processing

Edit `ImageProcessingOptions` in `src/core/types/index.ts` and update `ImageProcessor.process()` in `src/services/processing/image.processor.ts`.

---

## License

MIT
