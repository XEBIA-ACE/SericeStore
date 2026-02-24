/**
 * Integration tests for the Files REST API.
 *
 * Uses supertest to fire real HTTP requests against the Express app.
 * Storage provider is mocked at the factory level so no cloud credentials
 * or running services are required.
 */

import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../../../src/app';
import * as storageFactory from '../../../src/services/storage/storage.factory';
import { IStorageProvider } from '../../../src/core/interfaces/storage.interface';
import { Readable } from 'stream';
import { ListResult } from '../../../src/core/types';

// ─── Mock storage provider ────────────────────────────────────────────────────

const mockProvider: jest.Mocked<IStorageProvider> = {
  upload: jest.fn().mockResolvedValue('images/test-uuid.jpg'),
  download: jest.fn().mockResolvedValue(Readable.from(['binary-data'])),
  getPresignedUrl: jest.fn().mockResolvedValue('https://example.com/presigned?sig=abc'),
  delete: jest.fn().mockResolvedValue(undefined),
  deleteMany: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(true),
  getMetadata: jest.fn().mockResolvedValue({
    key: 'images/test-uuid.jpg',
    bucket: 'storage-service',
    mimeType: 'image/jpeg',
    size: 2048,
    provider: 'minio',
    uploadedAt: new Date().toISOString(),
  }),
  list: jest.fn().mockResolvedValue({
    files: [],
    isTruncated: false,
  } as ListResult),
  copy: jest.fn().mockResolvedValue(undefined),
  ensureBucket: jest.fn().mockResolvedValue(undefined),
  healthCheck: jest.fn().mockResolvedValue(true),
};

jest.mock('../../../src/services/storage/storage.factory', () => ({
  getStorageProvider: jest.fn(),
  resetStorageProvider: jest.fn(),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: Application;

beforeAll(() => {
  // Override AUTH_ENABLED so no JWT is required in tests
  process.env['AUTH_ENABLED'] = 'false';
  process.env['STORAGE_PROVIDER'] = 'minio';
  process.env['ENABLE_IMAGE_PROCESSING'] = 'false';
  process.env['ENABLE_VIDEO_PROCESSING'] = 'false';

  (storageFactory.getStorageProvider as jest.Mock).mockReturnValue(mockProvider);
  app = createApp();
});

afterEach(() => {
  jest.clearAllMocks();
  // Re-apply defaults after each test
  (storageFactory.getStorageProvider as jest.Mock).mockReturnValue(mockProvider);
  mockProvider.exists.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /health/live', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when all checks pass', async () => {
    mockProvider.healthCheck.mockResolvedValue(true);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.storage).toBe('ok');
  });

  it('returns 503 when storage is unhealthy', async () => {
    mockProvider.healthCheck.mockResolvedValue(false);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.storage).toBe('fail');
  });
});

describe('POST /api/v1/files', () => {
  it('uploads a valid image file and returns 201 with metadata', async () => {
    const res = await request(app)
      .post('/api/v1/files')
      .attach('file', Buffer.from('fake-image-data'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      category: 'image',
    });
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/v1/files');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 415 for disallowed MIME types', async () => {
    const res = await request(app)
      .post('/api/v1/files')
      .attach('file', Buffer.from('MZ'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    // Multer's fileFilter rejects it; multer emits an error that error middleware handles
    expect([400, 415]).toContain(res.status);
  });
});

describe('GET /api/v1/files', () => {
  it('returns a paginated list of files', async () => {
    const files = [
      {
        id: 'abc',
        originalName: 'test.jpg',
        key: 'images/test.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        category: 'image',
        bucket: 'storage-service',
        provider: 'minio',
        uploadedAt: new Date().toISOString(),
      },
    ];
    mockProvider.list.mockResolvedValue({ files, isTruncated: false });

    const res = await request(app).get('/api/v1/files');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('accepts prefix and maxKeys query params', async () => {
    mockProvider.list.mockResolvedValue({ files: [], isTruncated: false });

    const res = await request(app)
      .get('/api/v1/files')
      .query({ prefix: 'images/', maxKeys: '10' });

    expect(res.status).toBe(200);
    expect(mockProvider.list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'images/', maxKeys: 10 }),
    );
  });

  it('returns 400 for invalid maxKeys value', async () => {
    const res = await request(app).get('/api/v1/files').query({ maxKeys: '99999' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/files/:key/url', () => {
  it('returns a presigned URL', async () => {
    const res = await request(app)
      .get('/api/v1/files/images%2Ftest.jpg/url')
      .query({ expiresIn: '900' });

    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain('presigned');
    expect(res.body.data.expiresIn).toBe(900);
  });

  it('returns 404 for a non-existent file', async () => {
    mockProvider.exists.mockResolvedValue(false);
    const res = await request(app).get('/api/v1/files/ghost.jpg/url');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/files/:key', () => {
  it('deletes an existing file and returns success', async () => {
    const res = await request(app).delete('/api/v1/files/images%2Ftest.jpg');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockProvider.delete).toHaveBeenCalledWith('images/test.jpg', undefined);
  });

  it('returns 404 when file does not exist', async () => {
    mockProvider.exists.mockResolvedValue(false);
    const res = await request(app).delete('/api/v1/files/ghost.jpg');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/files (batch)', () => {
  it('deletes multiple files', async () => {
    const keys = ['images/a.jpg', 'images/b.jpg'];
    const res = await request(app)
      .delete('/api/v1/files')
      .send({ keys });

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(2);
    expect(mockProvider.deleteMany).toHaveBeenCalledWith(keys, undefined);
  });

  it('returns 400 when keys array is empty', async () => {
    const res = await request(app).delete('/api/v1/files').send({ keys: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/files/:key/copy', () => {
  it('copies a file to a new key', async () => {
    const res = await request(app)
      .post('/api/v1/files/images%2Foriginal.jpg/copy')
      .send({ destinationKey: 'images/copy.jpg' });

    expect(res.status).toBe(201);
    expect(res.body.data.destination).toBe('images/copy.jpg');
    expect(mockProvider.copy).toHaveBeenCalled();
  });

  it('returns 400 when destinationKey is missing', async () => {
    const res = await request(app)
      .post('/api/v1/files/images%2Foriginal.jpg/copy')
      .send({});

    expect(res.status).toBe(400);
  });
});
