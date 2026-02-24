import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
}

export type StorageProviderName = 's3' | 'gcs' | 'minio';

export const config = {
  app: {
    env: optional('NODE_ENV', 'development'),
    port: optionalNumber('PORT', 3000),
    logLevel: optional('LOG_LEVEL', 'info'),
  },

  storage: {
    provider: optional('STORAGE_PROVIDER', 's3') as StorageProviderName,
    defaultBucket: optional('DEFAULT_BUCKET', 'storage-service-bucket'),
    presignedUrlTtl: optionalNumber('PRESIGNED_URL_TTL_SECONDS', 3600),
  },

  aws: {
    accessKeyId: optional('AWS_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('AWS_SECRET_ACCESS_KEY', ''),
    region: optional('AWS_REGION', 'us-east-1'),
    bucket: optional('AWS_S3_BUCKET', ''),
    endpoint: optional('AWS_S3_ENDPOINT', ''), // for S3-compatible endpoints
  },

  gcs: {
    projectId: optional('GCS_PROJECT_ID', ''),
    bucket: optional('GCS_BUCKET', ''),
    keyFile: optional('GCS_KEY_FILE', ''),
  },

  minio: {
    endpoint: optional('MINIO_ENDPOINT', 'localhost'),
    port: optionalNumber('MINIO_PORT', 9000),
    accessKey: optional('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey: optional('MINIO_SECRET_KEY', 'minioadmin'),
    bucket: optional('MINIO_BUCKET', 'storage-service'),
    useSSL: optionalBool('MINIO_USE_SSL', false),
  },

  upload: {
    maxFileSizeMb: optionalNumber('MAX_FILE_SIZE_MB', 100),
    maxImageSizeMb: optionalNumber('MAX_IMAGE_SIZE_MB', 20),
    maxVideoSizeMb: optionalNumber('MAX_VIDEO_SIZE_MB', 500),
    allowedImageTypes: optional(
      'ALLOWED_IMAGE_TYPES',
      'image/jpeg,image/png,image/gif,image/webp,image/tiff',
    ).split(','),
    allowedVideoTypes: optional(
      'ALLOWED_VIDEO_TYPES',
      'video/mp4,video/mpeg,video/quicktime,video/x-msvideo,video/webm',
    ).split(','),
    allowedDocumentTypes: optional(
      'ALLOWED_DOCUMENT_TYPES',
      'application/pdf,text/plain,application/msword',
    ).split(','),
  },

  media: {
    imageThumbnailWidth: optionalNumber('IMAGE_THUMBNAIL_WIDTH', 320),
    imageThumbnailHeight: optionalNumber('IMAGE_THUMBNAIL_HEIGHT', 240),
    imageQuality: optionalNumber('IMAGE_QUALITY', 85),
    videoOutputFormat: optional('VIDEO_OUTPUT_FORMAT', 'mp4'),
    videoOutputCodec: optional('VIDEO_OUTPUT_CODEC', 'libx264'),
    videoOutputAudioCodec: optional('VIDEO_OUTPUT_AUDIO_CODEC', 'aac'),
    ffmpegPath: optional('FFMPEG_PATH', '/usr/bin/ffmpeg'),
    imageMagickPath: optional('IMAGEMAGICK_PATH', '/usr/bin/convert'),
  },

  rateLimit: {
    windowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    maxRequests: optionalNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  },

  auth: {
    enabled: optionalBool('AUTH_ENABLED', false),
    jwtSecret: optional('JWT_SECRET', 'change-me-in-production'),
    jwtExpiry: optional('JWT_EXPIRY', '1h'),
  },
} as const;
