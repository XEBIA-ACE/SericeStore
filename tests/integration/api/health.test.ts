/**
 * Integration tests for the health / readiness endpoints.
 *
 * These tests spin up the Express application with a mocked storage provider
 * so no real cloud credentials or media binaries are required.
 */

import request from 'supertest';
import { Express } from 'express';

// ── Mock the config before importing anything that reads it ─────────────────
jest.mock('../../../src/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    API_PREFIX: '/api/v1',
    API_SECRET_KEY: 'test-secret',
    STORAGE_PROVIDER: 'minio',
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
    MINIO_BUCKET: 'test-bucket',
    MAX_FILE_SIZE: 10_000_000,
    ALLOWED_MIME_TYPES: ['*'],
    TEMP_DIR: '/tmp/test-storage',
    IMAGEMAGICK_PATH: '',
    FFMPEG_PATH: '',
    FFPROBE_PATH: '',
    LOG_LEVEL: 'error',
    LOG_FORMAT: 'json',
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 1000,
    METRICS_ENDPOINT: '/metrics',
  },
}));

// ── Mock the storage provider factory to avoid real MinIO connections ────────
jest.mock('../../../src/services/storage/StorageProviderFactory', () => ({
  createStorageProvider: () => ({
    providerName: 'minio',
    initialize: jest.fn().mockResolvedValue(undefined),
    upload: jest.fn(),
    download: jest.fn(),
    getMetadata: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    copy: jest.fn(),
    getPresignedUrl: jest.fn(),
    list: jest.fn(),
  }),
}));

// Import after mocks
import { createApp } from '../../../src/app';

describe('Health endpoints', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  describe('GET /api/v1/health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.timestamp).toBeDefined();
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('should return 200 with readiness info', async () => {
      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.provider).toBe('minio');
    });
  });
});
