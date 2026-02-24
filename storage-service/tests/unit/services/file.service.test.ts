/**
 * Unit tests for FileService.
 * All dependencies (storage provider, image/video processors) are mocked.
 */

import { Readable } from 'stream';
import { FileService } from '../../../src/services/file.service';
import { IStorageProvider } from '../../../src/core/interfaces/storage.interface';
import { IImageProcessor, IVideoProcessor } from '../../../src/core/interfaces/processor.interface';
import { FileMetadata, ListResult } from '../../../src/core/types';
import { FileTooLargeError, NotFoundError, UnsupportedMediaTypeError } from '../../../src/utils/errors';

// ─── Mock factory helpers ─────────────────────────────────────────────────────

function makeMockStorage(): jest.Mocked<IStorageProvider> {
  return {
    upload: jest.fn().mockResolvedValue('images/test-id.jpg'),
    download: jest.fn().mockResolvedValue(Readable.from(['data'])),
    getPresignedUrl: jest.fn().mockResolvedValue('https://example.com/presigned'),
    delete: jest.fn().mockResolvedValue(undefined),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    getMetadata: jest.fn().mockResolvedValue({ key: 'test.jpg', size: 1024 }),
    list: jest.fn().mockResolvedValue({ files: [], isTruncated: false } as ListResult),
    copy: jest.fn().mockResolvedValue(undefined),
    ensureBucket: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(true),
  };
}

function makeMockImageProcessor(): jest.Mocked<IImageProcessor> {
  return {
    process: jest.fn().mockResolvedValue({
      primaryPath: '/tmp/processed.jpg',
      thumbnailPath: '/tmp/thumb.jpg',
      width: 800,
      height: 600,
      format: 'JPEG',
      sizeBytes: 50000,
    }),
    identify: jest.fn().mockResolvedValue({ width: 800, height: 600, format: 'JPEG' }),
    healthCheck: jest.fn().mockResolvedValue(true),
  };
}

function makeMockVideoProcessor(): jest.Mocked<IVideoProcessor> {
  return {
    process: jest.fn().mockResolvedValue({
      thumbnailPath: '/tmp/video-thumb.jpg',
      duration: 120,
      width: 1920,
      height: 1080,
    }),
    probe: jest.fn().mockResolvedValue({
      duration: 120,
      width: 1920,
      height: 1080,
      codec: 'h264',
      bitrate: 2000000,
      fps: 30,
      format: 'mp4',
    }),
    healthCheck: jest.fn().mockResolvedValue(true),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FileService', () => {
  let storage: jest.Mocked<IStorageProvider>;
  let imageProcessor: jest.Mocked<IImageProcessor>;
  let videoProcessor: jest.Mocked<IVideoProcessor>;
  let service: FileService;

  beforeEach(() => {
    storage = makeMockStorage();
    imageProcessor = makeMockImageProcessor();
    videoProcessor = makeMockVideoProcessor();
    service = new FileService(storage, imageProcessor, videoProcessor);
  });

  // ── uploadFile ─────────────────────────────────────────────────────────────

  describe('uploadFile', () => {
    it('calls storage.upload and returns FileMetadata', async () => {
      const result = await service.uploadFile(
        'photo.jpg',
        'image/jpeg',
        1024,
        Buffer.from('fake-image-data'),
        { processMedia: false },
      );

      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject<Partial<FileMetadata>>({
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        category: 'image',
      });
      expect(result.id).toBeDefined();
      expect(result.key).toMatch(/^images\//);
    });

    it('throws FileTooLargeError when file exceeds max size', async () => {
      const maxBytes = 100 * 1024 * 1024; // 100 MB (from config)
      await expect(
        service.uploadFile('big.jpg', 'image/jpeg', maxBytes + 1, Buffer.from('x'), { processMedia: false }),
      ).rejects.toBeInstanceOf(FileTooLargeError);
    });

    it('throws UnsupportedMediaTypeError for disallowed MIME types', async () => {
      await expect(
        service.uploadFile('virus.exe', 'application/x-msdownload', 100, Buffer.from('x'), { processMedia: false }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    });

    it('uses a custom key when provided in options', async () => {
      const result = await service.uploadFile(
        'photo.jpg',
        'image/jpeg',
        100,
        Buffer.from('data'),
        { key: 'custom/path/image.jpg', processMedia: false },
      );
      expect(result.key).toBe('custom/path/image.jpg');
    });
  });

  // ── downloadFile ──────────────────────────────────────────────────────────

  describe('downloadFile', () => {
    it('returns a readable stream for an existing file', async () => {
      storage.exists.mockResolvedValue(true);
      const stream = await service.downloadFile('images/test.jpg');
      expect(stream).toBeInstanceOf(Readable);
    });

    it('throws NotFoundError when file does not exist', async () => {
      storage.exists.mockResolvedValue(false);
      await expect(service.downloadFile('missing.jpg')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── getPresignedUrl ───────────────────────────────────────────────────────

  describe('getPresignedUrl', () => {
    it('returns a presigned URL string', async () => {
      storage.exists.mockResolvedValue(true);
      const url = await service.getPresignedUrl('images/test.jpg');
      expect(typeof url).toBe('string');
      expect(url).toContain('presigned');
    });

    it('throws NotFoundError for non-existent file', async () => {
      storage.exists.mockResolvedValue(false);
      await expect(service.getPresignedUrl('ghost.jpg')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── deleteFile ────────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    it('calls storage.delete for an existing file', async () => {
      storage.exists.mockResolvedValue(true);
      await service.deleteFile('images/test.jpg');
      expect(storage.delete).toHaveBeenCalledWith('images/test.jpg', undefined);
    });

    it('throws NotFoundError when file does not exist', async () => {
      storage.exists.mockResolvedValue(false);
      await expect(service.deleteFile('ghost.jpg')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── listFiles ─────────────────────────────────────────────────────────────

  describe('listFiles', () => {
    it('returns a ListResult', async () => {
      const mockResult: ListResult = {
        files: [
          {
            id: '1',
            originalName: 'a.jpg',
            key: 'images/a.jpg',
            mimeType: 'image/jpeg',
            size: 500,
            category: 'image',
            bucket: 'storage-service',
            provider: 'minio',
            uploadedAt: new Date().toISOString(),
          },
        ],
        isTruncated: false,
      };
      storage.list.mockResolvedValue(mockResult);
      const result = await service.listFiles({ prefix: 'images/' });
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.key).toBe('images/a.jpg');
    });
  });

  // ── healthCheck ───────────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns all-ok when all dependencies are healthy', async () => {
      const health = await service.healthCheck();
      expect(health.storage).toBe(true);
      expect(health.imageProcessor).toBe(true);
      expect(health.videoProcessor).toBe(true);
    });

    it('reflects storage failure', async () => {
      storage.healthCheck.mockResolvedValue(false);
      const health = await service.healthCheck();
      expect(health.storage).toBe(false);
    });
  });
});
