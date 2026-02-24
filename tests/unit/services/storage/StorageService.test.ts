import { Readable } from 'stream';
import { mock, MockProxy } from 'jest-mock-extended';
import { StorageService } from '../../../../src/services/storage/StorageService';
import { IStorageProvider, StorageObject, StorageListResult } from '../../../../src/core/interfaces/IStorageProvider';
import { NotFoundError } from '../../../../src/core/errors/AppError';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorageObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    key: 'test/key.jpg',
    size: 1024,
    contentType: 'image/jpeg',
    etag: 'abc123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageService', () => {
  let provider: MockProxy<IStorageProvider>;
  let service: StorageService;

  beforeEach(() => {
    provider = mock<IStorageProvider>();
    provider.providerName = 'minio';
    service = new StorageService(provider);
  });

  // ── upload ────────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('should upload a buffer and return UploadResult with a pre-signed URL', async () => {
      const buffer = Buffer.from('hello world');
      const storedObject = makeStorageObject({ size: buffer.length });

      provider.upload.mockResolvedValue(storedObject);
      provider.getPresignedUrl.mockResolvedValue('https://example.com/presigned');

      const result = await service.upload('photo.jpg', buffer, 'image/jpeg');

      expect(provider.upload).toHaveBeenCalledTimes(1);
      const [key, data, options] = provider.upload.mock.calls[0]!;
      expect(key).toMatch(/\.jpg$/);
      expect(data).toBe(buffer);
      expect(options.contentType).toBe('image/jpeg');

      expect(result.originalName).toBe('photo.jpg');
      expect(result.url).toBe('https://example.com/presigned');
    });

    it('should include user-supplied metadata in the upload call', async () => {
      provider.upload.mockResolvedValue(makeStorageObject());
      provider.getPresignedUrl.mockResolvedValue('https://example.com/x');

      await service.upload('doc.pdf', Buffer.from(''), 'application/pdf', {
        author: 'Alice',
      });

      const options = provider.upload.mock.calls[0]![2];
      expect(options.metadata).toMatchObject({ author: 'Alice' });
    });

    it('should prefix the generated key with the provided prefix', async () => {
      provider.upload.mockResolvedValue(makeStorageObject());
      provider.getPresignedUrl.mockResolvedValue('https://example.com/x');

      await service.upload('img.png', Buffer.from(''), 'image/png', undefined, 'avatars');

      const [key] = provider.upload.mock.calls[0]!;
      expect(key).toMatch(/^avatars\//);
    });
  });

  // ── download ──────────────────────────────────────────────────────────────

  describe('download', () => {
    it('should return the stream and metadata from the provider', async () => {
      const stream = Readable.from(['hello']);
      const meta = makeStorageObject();

      provider.download.mockResolvedValue(stream);
      provider.getMetadata.mockResolvedValue(meta);

      const result = await service.download('test/key.jpg');

      expect(result.stream).toBe(stream);
      expect(result.metadata).toBe(meta);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delegate delete to the provider', async () => {
      provider.delete.mockResolvedValue();

      await service.delete('some/key.jpg');

      expect(provider.delete).toHaveBeenCalledWith('some/key.jpg');
    });
  });

  // ── exists ────────────────────────────────────────────────────────────────

  describe('exists', () => {
    it('should return true when provider confirms existence', async () => {
      provider.exists.mockResolvedValue(true);
      await expect(service.exists('any/key')).resolves.toBe(true);
    });

    it('should return false when provider says the object is missing', async () => {
      provider.exists.mockResolvedValue(false);
      await expect(service.exists('ghost/key')).resolves.toBe(false);
    });
  });

  // ── copy ──────────────────────────────────────────────────────────────────

  describe('copy', () => {
    it('should pass a generated destination key when none is supplied', async () => {
      const copied = makeStorageObject({ key: 'new/generated-key.jpg' });
      provider.copy.mockResolvedValue(copied);

      const result = await service.copy('original/photo.jpg');

      expect(provider.copy).toHaveBeenCalledTimes(1);
      const [sourceKey] = provider.copy.mock.calls[0]!;
      expect(sourceKey).toBe('original/photo.jpg');
      expect(result).toBe(copied);
    });

    it('should use the explicit destination key when provided', async () => {
      const copied = makeStorageObject({ key: 'explicit/dest.jpg' });
      provider.copy.mockResolvedValue(copied);

      await service.copy('source/img.jpg', 'explicit/dest.jpg');

      const [, destKey] = provider.copy.mock.calls[0]!;
      expect(destKey).toBe('explicit/dest.jpg');
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should forward list parameters to the provider and return results', async () => {
      const listResult: StorageListResult = {
        items: [{ key: 'images/photo.jpg', size: 2048 }],
        isTruncated: false,
      };
      provider.list.mockResolvedValue(listResult);

      const result = await service.list('images/', 'cursor-abc', 50);

      expect(provider.list).toHaveBeenCalledWith('images/', 'cursor-abc', 50);
      expect(result).toBe(listResult);
    });
  });

  // ── getPresignedUrl ────────────────────────────────────────────────────────

  describe('getPresignedUrl', () => {
    it('should delegate to the provider', async () => {
      provider.getPresignedUrl.mockResolvedValue('https://signed-url.example.com');

      const url = await service.getPresignedUrl('some/key.jpg', { expiresIn: 600 });

      expect(url).toBe('https://signed-url.example.com');
      expect(provider.getPresignedUrl).toHaveBeenCalledWith('some/key.jpg', { expiresIn: 600 });
    });
  });
});
