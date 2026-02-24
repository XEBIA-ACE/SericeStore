/**
 * Integration tests for the Express REST API.
 *
 * These tests use supertest to send HTTP requests against the real Express app
 * but mock the StorageService so no cloud credentials are required.
 *
 * Prerequisites:
 *   - Set STORAGE_PROVIDER=minio (or s3) in the test environment
 *   - Mocking is done at the service layer, not the provider layer
 */

import request from 'supertest';
import { createApp } from '../../src/app';
import { StorageService } from '../../src/services/storage/StorageService';

// ---------------------------------------------------------------------------
// Mock the entire StorageService so no real cloud calls happen
// ---------------------------------------------------------------------------
jest.mock('../../src/services/storage/StorageService');
jest.mock('../../src/providers/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    create: jest.fn(() => ({
      name: 'minio',
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
      getPresignedUrl: jest.fn(),
      exists: jest.fn(),
      list: jest.fn(),
      copy: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue(true),
    })),
  },
}));

const mockUpload = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockDownload = jest.fn();
const mockDelete = jest.fn();
const mockList = jest.fn();
const mockCopy = jest.fn();

(StorageService as jest.MockedClass<typeof StorageService>).mockImplementation(() => ({
  upload: mockUpload,
  getPresignedUrl: mockGetPresignedUrl,
  download: mockDownload,
  delete: mockDelete,
  list: mockList,
  copy: mockCopy,
} as unknown as StorageService));

// ---------------------------------------------------------------------------

const app = createApp();

describe('GET /health/live', () => {
  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });
});

describe('GET /health', () => {
  it('should return 200 when storage is healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(['healthy', 'degraded']).toContain(res.body.data.status);
  });
});

describe('POST /v1/objects', () => {
  beforeEach(() => {
    mockUpload.mockResolvedValue({
      object: {
        id: 'abc-123',
        originalName: 'test.jpg',
        key: 'images/2024/01/abc-123.jpg',
        bucket: 'test-bucket',
        contentType: 'image/jpeg',
        size: 1024,
        provider: 'minio',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      presignedUrl: 'https://example.com/presigned',
      thumbnailPresignedUrl: undefined,
    });
  });

  it('should return 400 when no file is provided', async () => {
    const res = await request(app)
      .post('/v1/objects')
      .set('Content-Type', 'multipart/form-data');
    expect(res.status).toBe(400);
  });

  it('should return 201 when a valid image is uploaded', async () => {
    const res = await request(app)
      .post('/v1/objects')
      .attach('file', Buffer.from('fake-image'), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.object.key).toBeDefined();
    expect(res.body.data.presignedUrl).toBe('https://example.com/presigned');
  });
});

describe('GET /v1/objects', () => {
  it('should return a list of objects', async () => {
    mockList.mockResolvedValue([
      { key: 'images/a.jpg', size: 512, lastModified: new Date() },
    ]);

    const res = await request(app).get('/v1/objects');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });
});

describe('DELETE /v1/objects/:key', () => {
  it('should return 204 for a valid delete', async () => {
    mockDelete.mockResolvedValue(undefined);

    const res = await request(app).delete('/v1/objects/images%2F2024%2F01%2Ftest.jpg');
    expect(res.status).toBe(204);
  });
});

describe('POST /v1/objects/copy', () => {
  it('should return 201 on successful copy', async () => {
    mockCopy.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/v1/objects/copy')
      .send({ sourceKey: 'images/a.jpg', destKey: 'images/b.jpg' });

    expect(res.status).toBe(201);
  });

  it('should return 400 when body is missing required fields', async () => {
    const res = await request(app)
      .post('/v1/objects/copy')
      .send({ sourceKey: 'images/a.jpg' }); // missing destKey

    expect(res.status).toBe(400);
  });
});
