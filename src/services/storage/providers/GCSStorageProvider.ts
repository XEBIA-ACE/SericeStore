import { Storage, File } from '@google-cloud/storage';
import { Readable } from 'stream';
import {
  IStorageProvider,
  StorageObject,
  UploadOptions,
  PresignOptions,
  StorageListResult,
} from '../../../core/interfaces/IStorageProvider';
import { StorageError, NotFoundError } from '../../../core/errors/AppError';
import { logger } from '../../../utils/logger';

export interface GCSProviderConfig {
  projectId: string;
  bucket: string;
  /** Path to a service-account JSON key file */
  keyFilename?: string;
}

export class GCSStorageProvider implements IStorageProvider {
  public readonly providerName = 'gcs';
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(private readonly cfg: GCSProviderConfig) {
    this.bucketName = cfg.bucket;
    this.storage = new Storage({
      projectId: cfg.projectId,
      ...(cfg.keyFilename && { keyFilename: cfg.keyFilename }),
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    const bucket = this.storage.bucket(this.bucketName);
    const [exists] = await bucket.exists();
    if (!exists) {
      logger.info(`Creating GCS bucket "${this.bucketName}"…`);
      await bucket.create();
    } else {
      logger.info(`GCS bucket "${this.bucketName}" already exists`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private file(key: string): File {
    return this.storage.bucket(this.bucketName).file(key);
  }

  private toStorageObject(file: File, size = 0, contentType = 'application/octet-stream'): StorageObject {
    const meta = file.metadata as Record<string, unknown>;
    return {
      key: file.name,
      size: Number(meta['size'] ?? size),
      contentType: String(meta['contentType'] ?? contentType),
      etag: meta['etag'] as string | undefined,
      lastModified: meta['updated'] as string | undefined,
      metadata: meta['metadata'] as Record<string, string> | undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  async upload(key: string, data: Buffer | Readable, options: UploadOptions): Promise<StorageObject> {
    const file = this.file(key);
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: options.contentType,
        metadata: options.metadata,
      },
      resumable: false,
    });

    return new Promise((resolve, reject) => {
      let size = 0;

      const handleStream = (stream: Readable): void => {
        stream.on('data', (chunk: Buffer) => { size += chunk.length; });
        stream.on('error', reject);
        stream.pipe(writeStream);
      };

      if (Buffer.isBuffer(data)) {
        size = data.length;
        writeStream.end(data);
      } else {
        handleStream(data);
      }

      writeStream.on('error', (err) => reject(new StorageError(`Failed to upload "${key}" to GCS`, err)));
      writeStream.on('finish', () => {
        logger.debug(`Uploaded object to GCS: ${key}`);
        resolve({
          key,
          size,
          contentType: options.contentType,
          metadata: options.metadata,
        });
      });
    });
  }

  async download(key: string): Promise<Readable> {
    const file = this.file(key);
    const [exists] = await file.exists();
    if (!exists) throw new NotFoundError(`Object "${key}" not found in GCS`);
    return file.createReadStream() as unknown as Readable;
  }

  async getMetadata(key: string): Promise<StorageObject> {
    try {
      const file = this.file(key);
      const [metadata] = await file.getMetadata();
      return {
        key,
        size: Number(metadata['size'] ?? 0),
        contentType: String(metadata['contentType'] ?? 'application/octet-stream'),
        etag: metadata['etag'] as string | undefined,
        lastModified: metadata['updated'] as string | undefined,
        metadata: metadata['metadata'] as Record<string, string> | undefined,
      };
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error.code === 404) throw new NotFoundError(`Object "${key}" not found in GCS`);
      throw new StorageError(`Failed to get metadata for "${key}"`, err as Error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.file(key).delete();
      logger.debug(`Deleted GCS object: ${key}`);
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error.code === 404) throw new NotFoundError(`Object "${key}" not found in GCS`);
      throw new StorageError(`Failed to delete "${key}" from GCS`, err as Error);
    }
  }

  async exists(key: string): Promise<boolean> {
    const [exists] = await this.file(key).exists();
    return exists;
  }

  async copy(sourceKey: string, destinationKey: string): Promise<StorageObject> {
    try {
      await this.file(sourceKey).copy(this.file(destinationKey));
      return this.getMetadata(destinationKey);
    } catch (err) {
      throw new StorageError(`Failed to copy "${sourceKey}" → "${destinationKey}" in GCS`, err as Error);
    }
  }

  async getPresignedUrl(key: string, options: PresignOptions = {}): Promise<string> {
    const { expiresIn = 3600, method = 'GET' } = options;
    try {
      const [url] = await this.file(key).getSignedUrl({
        action: method === 'GET' ? 'read' : 'write',
        expires: Date.now() + expiresIn * 1000,
      });
      return url;
    } catch (err) {
      throw new StorageError(`Failed to generate pre-signed URL for "${key}"`, err as Error);
    }
  }

  async list(prefix = '', cursor?: string, limit = 100): Promise<StorageListResult> {
    try {
      const [files, , apiResponse] = await this.storage.bucket(this.bucketName).getFiles({
        prefix: prefix || undefined,
        pageToken: cursor,
        maxResults: limit,
        autoPaginate: false,
      });

      const nextPageToken = (apiResponse as Record<string, unknown>)?.['nextPageToken'] as string | undefined;

      return {
        items: files.map((f) => ({
          key: f.name,
          size: Number(f.metadata['size'] ?? 0),
          lastModified: f.metadata['updated'] as string | undefined,
        })),
        nextCursor: nextPageToken,
        isTruncated: !!nextPageToken,
      };
    } catch (err) {
      throw new StorageError('Failed to list GCS objects', err as Error);
    }
  }
}
