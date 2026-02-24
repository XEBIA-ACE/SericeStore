/**
 * Integration tests for the /storage API endpoints.
 *
 * All external dependencies (storage provider) are mocked so that tests run
 * in a pure Node.js environment without cloud credentials.
 */

import request from 'supertest';
import { Express } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';

// ── Shared mock objects ────────────────────────────────────────────────────

const mockStorageObject = {
  key: 'images/2024/01/01/test-uuid.jpg',
  size: 1024,
  contentType: 'image/jpeg',
  etag: 'abc123',
  lastModified: '2024-01-01T00:00:00.000Z',
};

const mockProvider = {
  providerName: 'minio',
  initialize: jest.fn().mockResolvedValue(undefined),
  upload: jest.fn().mockResolvedValue(mockStorageObject),
  download: jest.fn().mockResolvedValue(Readable.from(['file content'])),
  getMetadata: jest.fn().mockResolvedValue(mockStorageObject),
  delete: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(true),
  copy: jest.fn().mockResolvedValue(mockStorageObject),
  getPresignedUrl: jest.fn().mockResolvedValue('https://example.com/presigned'),
  list: jest.fn().mockResolvedValue({
    items: [mockStorageObject],
    isTruncated: false,
  }),
};

// ── Mocks must be set up before the module under test is imported ────────────

jest.mock('../../../src/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3002,
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
    TEMP_DIR: os.tmpdir(),
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

jest.mock('../../../src/services/storage/StorageProviderFactory', () => ({
  createStorageProvider: () => mockProvider,
}));

import { createApp } from '../../../src/app';

const AUTH_HEADER = 'Bearer test-secret';

describe('Storage API', () => {
  let app: Express;
  let testFilePath: string;

  beforeAll(() => {
    app = createApp();

    // Create a small temporary test file for upload tests
    testFilePath = path.join(os.tmpdir(), 'test-upload.jpg');
    fs.writeFileSync(testFilePath, Buffer.from('fake-jpeg-data'));
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider.upload.mockResolvedValue(mockStorageObject);
    mockProvider.exists.mockResolvedValue(true);
    mockProvider.getMetadata.mockResolvedValue(mockStorageObject);
    mockProvider.download.mockResolvedValue(Readable.from(['file content']));
    mockProvider.getPresignedUrl.mockResolvedValue('https://example.com/presigned');
    mockProvider.list.mockResolvedValue({ items: [mockStorageObject], isTruncated: false });
    mockProvider.copy.mockResolvedValue(mockStorageObject);
    mockProvider.delete.mockResolvedValue(undefined);
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('should reject requests without Authorization header', async () => {
      const res = await request(app).get('/api/v1/storage');
      expect(res.status).toBe(401);
    });

    it('should reject requests with wrong token', async () => {
      const res = await request(app)
        .get('/api/v1/storage')
        .set('Authorization', 'Bearer wrong-token');
      expect(res.status).toBe(401);
    });
  });

  // ── List ───────────────────────────────────────────────────────────────────

  describe('GET /api/v1/storage', () => {
    it('should return a paginated list of objects', async () => {
      const res = await request(app)
        .get('/api/v1/storage')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it('should forward prefix and limit query params', async () => {
      await request(app)
        .get('/api/v1/storage?prefix=images&limit=50')
        .set('Authorization', AUTH_HEADER);

      expect(mockProvider.list).toHaveBeenCalledWith('images', undefined, 50);
    });
  });

  // ── Upload ─────────────────────────────────────────────────────────────────

  describe('POST /api/v1/storage/upload', () => {
    it('should upload a file and return 201 with the storage key', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('Authorization', AUTH_HEADER)
        .attach('file', testFilePath);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBeDefined();
    });

    it('should return 400 when no file is attached', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(400);
    });
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('GET /api/v1/storage/:key/metadata', () => {
    it('should return object metadata', async () => {
      const res = await request(app)
        .get('/api/v1/storage/images%2Fphoto.jpg/metadata')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data.contentType).toBe('image/jpeg');
    });
  });

  // ── Presign ───────────────────────────────────────────────────────────────

  describe('GET /api/v1/storage/:key/presign', () => {
    it('should return a pre-signed URL', async () => {
      const res = await request(app)
        .get('/api/v1/storage/images%2Fphoto.jpg/presign')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data.url).toBe('https://example.com/presigned');
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/storage/:key', () => {
    it('should delete an object and return success', async () => {
      const res = await request(app)
        .delete('/api/v1/storage/images%2Fphoto.jpg')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });

    it('should return 404 when the object does not exist', async () => {
      mockProvider.exists.mockResolvedValue(false);

      const res = await request(app)
        .delete('/api/v1/storage/ghost%2Fkey.jpg')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
    });
  });

  // ── Copy ─────────────────────────────────────────────────────────────────

  describe('POST /api/v1/storage/:key/copy', () => {
    it('should copy an object and return the new metadata', async () => {
      const res = await request(app)
        .post('/api/v1/storage/images%2Fphoto.jpg/copy')
        .set('Authorization', AUTH_HEADER)
        .send({ destinationKey: 'copies/photo.jpg' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });
});
