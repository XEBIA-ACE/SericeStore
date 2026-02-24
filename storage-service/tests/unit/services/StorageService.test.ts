import { StorageService } from '../../../src/services/storage/StorageService';
import { IStorageProvider, UploadOptions, UploadResult } from '../../../src/core/interfaces/IStorageProvider';
import { IImageProcessor } from '../../../src/core/interfaces/IMediaProcessor';
import { ProcessedImage, ObjectListItem } from '../../../src/core/entities/StoredObject';
import { NotFoundError, UnsupportedMediaTypeError } from '../../../src/core/errors/AppError';

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------
const mockProvider: jest.Mocked<IStorageProvider> = {
  name: 's3',
  upload: jest.fn(),
  download: jest.fn(),
  delete: jest.fn(),
  getPresignedUrl: jest.fn(),
  exists: jest.fn(),
  list: jest.fn(),
  copy: jest.fn(),
  healthCheck: jest.fn(),
};

// ---------------------------------------------------------------------------
// Mock image processor
// ---------------------------------------------------------------------------
const mockImageProcessor: jest.Mocked<IImageProcessor> = {
  process: jest.fn(),
  getMetadata: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const smallImageBuffer = Buffer.from('fake-image-data');
const smallDocumentBuffer = Buffer.from('fake-pdf-data');

function makeService(): StorageService {
  return new StorageService(mockProvider, mockImageProcessor);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementations
    mockProvider.upload.mockResolvedValue({
      key: 'images/2024/01/test.jpg',
      bucket: 'test-bucket',
      etag: '"abc123"',
    } satisfies UploadResult);
    mockProvider.getPresignedUrl.mockResolvedValue('https://example.com/presigned-url');
    mockProvider.exists.mockResolvedValue(true);
    mockProvider.download.mockResolvedValue(Buffer.from('file-content'));
    mockProvider.list.mockResolvedValue([]);
  });

  describe('upload()', () => {
    it('should upload a valid image file and return a presigned URL', async () => {
      const service = makeService();

      const result = await service.upload({
        buffer: smallImageBuffer,
        originalName: 'photo.jpg',
        contentType: 'image/jpeg',
      });

      expect(mockProvider.upload).toHaveBeenCalledTimes(1);
      expect(result.presignedUrl).toBe('https://example.com/presigned-url');
      expect(result.object.contentType).toBe('image/jpeg');
      expect(result.object.originalName).toBe('photo.jpg');
    });

    it('should throw UnsupportedMediaTypeError for disallowed MIME type', async () => {
      const service = makeService();

      await expect(
        service.upload({
          buffer: Buffer.from('data'),
          originalName: 'script.sh',
          contentType: 'application/x-sh',
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);
    });

    it('should process image and upload thumbnail when processImage=true', async () => {
      mockImageProcessor.process.mockResolvedValue({
        processedBuffer: Buffer.from('processed'),
        thumbnailBuffer: Buffer.from('thumbnail'),
        metadata: {
          key: 'images/2024/01/test.jpg',
          thumbnailKey: 'images/2024/01/thumbnails/test_thumb.jpg',
          width: 1920,
          height: 1080,
          format: 'jpeg',
          size: 100_000,
        } as ProcessedImage,
      });

      const service = makeService();

      await service.upload({
        buffer: smallImageBuffer,
        originalName: 'photo.jpg',
        contentType: 'image/jpeg',
        processImage: true,
      });

      // Two uploads: thumbnail + original
      expect(mockProvider.upload).toHaveBeenCalledTimes(2);
    });

    it('should upload a PDF document without image processing', async () => {
      const service = makeService();

      const result = await service.upload({
        buffer: smallDocumentBuffer,
        originalName: 'document.pdf',
        contentType: 'application/pdf',
      });

      expect(mockImageProcessor.process).not.toHaveBeenCalled();
      expect(result.object.contentType).toBe('application/pdf');
    });
  });

  describe('download()', () => {
    it('should return a Buffer for an existing object', async () => {
      const service = makeService();
      const buffer = await service.download('images/2024/01/test.jpg');
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should throw NotFoundError when object does not exist', async () => {
      mockProvider.exists.mockResolvedValue(false);
      const service = makeService();

      await expect(service.download('nonexistent/key.jpg')).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete()', () => {
    it('should delete an existing object', async () => {
      const service = makeService();
      await service.delete('images/2024/01/test.jpg');
      expect(mockProvider.delete).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundError when object does not exist', async () => {
      mockProvider.exists.mockResolvedValue(false);
      const service = makeService();
      await expect(service.delete('nonexistent/key.jpg')).rejects.toThrow(NotFoundError);
    });
  });

  describe('list()', () => {
    it('should return an array of object list items', async () => {
      const items: ObjectListItem[] = [
        { key: 'images/2024/01/a.jpg', size: 1024, lastModified: new Date() },
        { key: 'images/2024/01/b.jpg', size: 2048, lastModified: new Date() },
      ];
      mockProvider.list.mockResolvedValue(items);

      const service = makeService();
      const result = await service.list(undefined, { prefix: 'images/' });

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('images/2024/01/a.jpg');
    });
  });

  describe('getPresignedUrl()', () => {
    it('should return a presigned URL for an existing object', async () => {
      const service = makeService();
      const url = await service.getPresignedUrl('images/2024/01/test.jpg');
      expect(url).toContain('presigned-url');
    });

    it('should throw NotFoundError for a non-existent object', async () => {
      mockProvider.exists.mockResolvedValue(false);
      const service = makeService();
      await expect(service.getPresignedUrl('no/such/key.jpg')).rejects.toThrow(NotFoundError);
    });
  });
});
