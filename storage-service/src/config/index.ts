/**
 * Centralised configuration module.
 * All values are read from environment variables; defaults are provided where safe.
 * Never hard-code secrets here — use .env or secrets manager in production.
 */

import path from 'path';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function getEnvInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

function getEnvBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true';
}

// ─── App ──────────────────────────────────────────────────────────────────────

export const appConfig = {
  env: getEnv('NODE_ENV', 'development'),
  port: getEnvInt('PORT', 3000),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  serviceName: getEnv('SERVICE_NAME', 'storage-service'),
  version: '1.0.0',
  isDev: getEnv('NODE_ENV', 'development') === 'development',
  isProd: getEnv('NODE_ENV', 'development') === 'production',
} as const;

// ─── Storage Provider ─────────────────────────────────────────────────────────

export const storageConfig = {
  provider: getEnv('STORAGE_PROVIDER', 'minio') as 's3' | 'gcs' | 'minio',
  maxFileSizeBytes: getEnvInt('MAX_FILE_SIZE_MB', 100) * 1024 * 1024,
  allowedImageTypes: getEnv(
    'ALLOWED_IMAGE_TYPES',
    'image/jpeg,image/png,image/gif,image/webp,image/tiff,image/bmp',
  ).split(','),
  allowedVideoTypes: getEnv(
    'ALLOWED_VIDEO_TYPES',
    'video/mp4,video/mpeg,video/quicktime,video/x-msvideo,video/webm',
  ).split(','),
  allowedDocumentTypes: getEnv(
    'ALLOWED_DOCUMENT_TYPES',
    'application/pdf,text/plain,application/json',
  ).split(','),
  presignedUrlTtl: getEnvInt('PRESIGNED_URL_TTL', 3600),
} as const;

// ─── AWS S3 ───────────────────────────────────────────────────────────────────

export const s3Config = {
  region: getEnv('AWS_REGION', 'us-east-1'),
  accessKeyId: getEnv('AWS_ACCESS_KEY_ID', ''),
  secretAccessKey: getEnv('AWS_SECRET_ACCESS_KEY', ''),
  bucket: getEnv('AWS_S3_BUCKET', 'storage-service'),
  endpoint: process.env['AWS_S3_ENDPOINT'] || undefined,
  forcePathStyle: !!process.env['AWS_S3_ENDPOINT'], // needed for LocalStack / custom endpoints
} as const;

// ─── Google Cloud Storage ─────────────────────────────────────────────────────

export const gcsConfig = {
  projectId: getEnv('GCS_PROJECT_ID', ''),
  bucket: getEnv('GCS_BUCKET', 'storage-service'),
  keyFile: process.env['GCS_KEY_FILE']
    ? path.resolve(process.env['GCS_KEY_FILE'])
    : undefined,
  credentialsBase64: process.env['GCS_CREDENTIALS_BASE64'] || undefined,
} as const;

// ─── MinIO ────────────────────────────────────────────────────────────────────

export const minioConfig = {
  endpoint: getEnv('MINIO_ENDPOINT', 'localhost'),
  port: getEnvInt('MINIO_PORT', 9000),
  useSSL: getEnvBool('MINIO_USE_SSL', false),
  accessKey: getEnv('MINIO_ACCESS_KEY', 'minioadmin'),
  secretKey: getEnv('MINIO_SECRET_KEY', 'minioadmin'),
  bucket: getEnv('MINIO_BUCKET', 'storage-service'),
} as const;

// ─── Image Processing ─────────────────────────────────────────────────────────

export const imageConfig = {
  enabled: getEnvBool('ENABLE_IMAGE_PROCESSING', true),
  imageMagickPath: getEnv('IMAGE_MAGICK_PATH', '/usr/bin/convert'),
  defaultQuality: getEnvInt('DEFAULT_IMAGE_QUALITY', 85),
  thumbnailWidth: getEnvInt('THUMBNAIL_WIDTH', 200),
  thumbnailHeight: getEnvInt('THUMBNAIL_HEIGHT', 200),
} as const;

// ─── Video Processing ─────────────────────────────────────────────────────────

export const videoConfig = {
  enabled: getEnvBool('ENABLE_VIDEO_PROCESSING', true),
  ffmpegPath: getEnv('FFMPEG_PATH', '/usr/bin/ffmpeg'),
  ffprobePath: getEnv('FFPROBE_PATH', '/usr/bin/ffprobe'),
  thumbnailSecond: getEnvInt('VIDEO_THUMBNAIL_SECOND', 5),
} as const;

// ─── Authentication ───────────────────────────────────────────────────────────

export const authConfig = {
  enabled: getEnvBool('AUTH_ENABLED', true),
  jwtSecret: getEnv('JWT_SECRET', 'change-me-in-production'),
  jwtExpiry: getEnv('JWT_EXPIRY', '1h'),
} as const;

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const rateLimitConfig = {
  windowMs: getEnvInt('RATE_LIMIT_WINDOW_MS', 60_000),
  maxRequests: getEnvInt('RATE_LIMIT_MAX_REQUESTS', 100),
} as const;

// ─── CORS ─────────────────────────────────────────────────────────────────────

export const corsConfig = {
  origins: getEnv('CORS_ORIGINS', 'http://localhost:3001').split(','),
} as const;
