import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file before validating
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('/api/v1'),

  // Auth
  API_SECRET_KEY: z.string().min(8, 'API_SECRET_KEY must be at least 8 characters'),

  // Storage provider
  STORAGE_PROVIDER: z.enum(['s3', 'gcs', 'minio']).default('minio'),

  // AWS S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_ENDPOINT: z.string().optional(),

  // GCS
  GCS_PROJECT_ID: z.string().optional(),
  GCS_BUCKET: z.string().optional(),
  GCS_KEY_FILE: z.string().optional(),

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('storage-service'),

  // Upload
  MAX_FILE_SIZE: z.coerce.number().int().positive().default(524_288_000), // 500 MB
  ALLOWED_MIME_TYPES: z
    .string()
    .default('*')
    .transform((v) => (v === '*' ? ['*'] : v.split(',').map((s) => s.trim()))),

  // Media processing
  TEMP_DIR: z.string().default('/tmp/storage-service'),
  IMAGEMAGICK_PATH: z.string().default(''),
  FFMPEG_PATH: z.string().default(''),
  FFPROBE_PATH: z.string().default(''),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'simple']).default('json'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Metrics
  METRICS_ENDPOINT: z.string().default('/metrics'),
});

// ---------------------------------------------------------------------------
// Parse & export
// ---------------------------------------------------------------------------
const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
