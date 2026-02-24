import { Readable } from 'stream';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  IStorageProvider,
  StorageObject,
  PresignOptions,
  StorageListResult,
} from '../../core/interfaces/IStorageProvider';
import { UploadResult } from '../../core/types';
import { storageBytesUploaded, storageBytesDownloaded } from '../../utils/metrics';
import { logger } from '../../utils/logger';

/**
 * High-level storage service that delegates to the active IStorageProvider.
 * Business logic such as key generation, metric recording, and cross-provider
 * abstraction lives here rather than in the provider adapters.
 */
export class StorageService {
  constructor(private readonly provider: IStorageProvider) {}

  get providerName(): string {
    return this.provider.providerName;
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
  }

  // ---------------------------------------------------------------------------
  // Uploads
  // ---------------------------------------------------------------------------

  /**
   * Store a file in the active storage backend.
   *
   * @param originalName  - Original filename (used only for extension extraction)
   * @param data          - File data as a Buffer or Readable stream
   * @param contentType   - MIME type
   * @param metadata      - Optional key-value metadata to attach
   * @param prefix        - Optional path prefix (e.g. 'images', 'videos')
   * @returns             UploadResult with the generated storage key and URL
   */
  async upload(
    originalName: string,
    data: Buffer | Readable,
    contentType: string,
    metadata?: Record<string, string>,
    prefix?: string,
  ): Promise<UploadResult> {
    const ext = path.extname(originalName).toLowerCase();
    const key = this.generateKey(prefix, ext);

    const stored: StorageObject = await this.provider.upload(key, data, {
      contentType,
      metadata: { ...metadata, originalName },
    });

    // Record bytes for metrics (only known for Buffer uploads)
    if (stored.size > 0) {
      storageBytesUploaded.inc({ provider: this.provider.providerName }, stored.size);
    }

    const url = await this.provider.getPresignedUrl(key, { expiresIn: 3600 });

    logger.info('File uploaded', { key, size: stored.size, contentType });

    return {
      key,
      originalName,
      contentType,
      size: stored.size,
      etag: stored.etag,
      url,
    };
  }

  // ---------------------------------------------------------------------------
  // Downloads
  // ---------------------------------------------------------------------------

  async download(key: string): Promise<{ stream: Readable; metadata: StorageObject }> {
    const [stream, metadata] = await Promise.all([
      this.provider.download(key),
      this.provider.getMetadata(key),
    ]);

    storageBytesDownloaded.inc({ provider: this.provider.providerName }, metadata.size);
    logger.info('File downloaded', { key });

    return { stream, metadata };
  }

  // ---------------------------------------------------------------------------
  // Metadata & existence
  // ---------------------------------------------------------------------------

  async getMetadata(key: string): Promise<StorageObject> {
    return this.provider.getMetadata(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.provider.exists(key);
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async delete(key: string): Promise<void> {
    await this.provider.delete(key);
    logger.info('File deleted', { key });
  }

  // ---------------------------------------------------------------------------
  // Copy
  // ---------------------------------------------------------------------------

  async copy(sourceKey: string, destinationKey?: string): Promise<StorageObject> {
    const destKey = destinationKey ?? this.generateKey(undefined, path.extname(sourceKey));
    const result = await this.provider.copy(sourceKey, destKey);
    logger.info('File copied', { sourceKey, destKey });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Pre-signed URLs
  // ---------------------------------------------------------------------------

  async getPresignedUrl(key: string, options?: PresignOptions): Promise<string> {
    return this.provider.getPresignedUrl(key, options);
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async list(prefix?: string, cursor?: string, limit?: number): Promise<StorageListResult> {
    return this.provider.list(prefix, cursor, limit);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a collision-resistant storage key.
   * Format: [prefix/]YYYY/MM/DD/<uuid><ext>
   */
  private generateKey(prefix?: string, ext = ''): string {
    const now = new Date();
    const datePath = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('/');

    const segments = [prefix, datePath, `${uuidv4()}${ext}`].filter(Boolean);
    return segments.join('/');
  }
}
