import { v4 as uuidv4 } from 'uuid';
import { IStorageProvider } from '../../core/interfaces/IStorageProvider';
import { IImageProcessor } from '../../core/interfaces/IMediaProcessor';
import { StoredObject, ObjectListItem } from '../../core/entities/StoredObject';
import {
  StorageError,
  NotFoundError,
  UnsupportedMediaTypeError,
  FileTooLargeError,
} from '../../core/errors/AppError';
import { createLogger } from '../../utils/logger';
import { config } from '../../config';
import {
  generateStorageKey,
  prefixFromMime,
  thumbnailKey,
} from '../../utils/keyGenerator';

const log = createLogger('StorageService');

export interface UploadFileInput {
  buffer: Buffer;
  originalName: string;
  contentType: string;
  metadata?: Record<string, string>;
  /** Override bucket; defaults to STORAGE_PROVIDER's configured bucket */
  bucket?: string;
  /** Process image (resize, thumbnail) if true */
  processImage?: boolean;
}

export interface UploadFileResult {
  object: StoredObject;
  presignedUrl: string;
  thumbnailPresignedUrl?: string;
}

export interface ListObjectsOptions {
  prefix?: string;
  maxKeys?: number;
}

/**
 * Core storage orchestration service.
 *
 * Coordinates the storage provider (S3 / GCS / MinIO) and optionally
 * the image processor for upload pipelines.
 */
export class StorageService {
  constructor(
    private readonly provider: IStorageProvider,
    private readonly imageProcessor: IImageProcessor,
  ) {}

  /**
   * Upload a file, optionally processing it as an image.
   */
  async upload(input: UploadFileInput): Promise<UploadFileResult> {
    this.validateUpload(input);

    const bucket = input.bucket ?? this.defaultBucket();
    const isImage = input.contentType.startsWith('image/');
    const prefix = prefixFromMime(input.contentType);
    const key = generateStorageKey(input.originalName, prefix);

    log.info('Uploading file', { key, bucket, contentType: input.contentType });

    let buffer = input.buffer;
    let thumbKey: string | undefined;

    // ── Image processing pipeline ──────────────────────────────────────────
    if (isImage && input.processImage) {
      const { processedBuffer, thumbnailBuffer, metadata } = await this.imageProcessor.process(
        input.buffer,
        key,
        {
          generateThumbnail: true,
          thumbnailWidth: config.media.imageThumbnailWidth,
          thumbnailHeight: config.media.imageThumbnailHeight,
        },
      );

      buffer = processedBuffer;

      // Upload thumbnail if generated
      if (thumbnailBuffer) {
        thumbKey = thumbnailKey(key);
        await this.provider.upload(bucket, thumbKey, thumbnailBuffer, {
          contentType: 'image/jpeg',
          metadata: { originalKey: key },
        });
        log.info('Thumbnail uploaded', { thumbKey });
      }

      log.debug('Image processed', { key, ...metadata });
    }

    // ── Primary upload ─────────────────────────────────────────────────────
    const uploadResult = await this.provider.upload(bucket, key, buffer, {
      contentType: input.contentType,
      metadata: {
        originalName: input.originalName,
        ...(input.metadata ?? {}),
      },
    });

    // ── Build domain entity ────────────────────────────────────────────────
    const now = new Date().toISOString();
    const object: StoredObject = {
      id: uuidv4(),
      originalName: input.originalName,
      key: uploadResult.key,
      bucket: uploadResult.bucket,
      contentType: input.contentType,
      size: buffer.length,
      provider: this.provider.name as StoredObject['provider'],
      metadata: input.metadata ?? {},
      etag: uploadResult.etag,
      createdAt: now,
      updatedAt: now,
    };

    const presignedUrl = await this.provider.getPresignedUrl(bucket, key);
    const thumbnailPresignedUrl = thumbKey
      ? await this.provider.getPresignedUrl(bucket, thumbKey)
      : undefined;

    return { object, presignedUrl, thumbnailPresignedUrl };
  }

  /**
   * Generate a fresh presigned GET URL for an existing object.
   */
  async getPresignedUrl(
    key: string,
    bucket?: string,
    expiresIn?: number,
  ): Promise<string> {
    const b = bucket ?? this.defaultBucket();

    const exists = await this.provider.exists(b, key);
    if (!exists) throw new NotFoundError('Object', key);

    return this.provider.getPresignedUrl(b, key, { expiresIn });
  }

  /**
   * Download a file as a Buffer.
   */
  async download(key: string, bucket?: string): Promise<Buffer> {
    const b = bucket ?? this.defaultBucket();
    const exists = await this.provider.exists(b, key);
    if (!exists) throw new NotFoundError('Object', key);
    return this.provider.download(b, key);
  }

  /**
   * Delete an object.
   */
  async delete(key: string, bucket?: string): Promise<void> {
    const b = bucket ?? this.defaultBucket();
    const exists = await this.provider.exists(b, key);
    if (!exists) throw new NotFoundError('Object', key);
    await this.provider.delete(b, key);
    log.info('Object deleted', { key, bucket: b });
  }

  /**
   * List objects under a prefix.
   */
  async list(bucket?: string, options: ListObjectsOptions = {}): Promise<ObjectListItem[]> {
    const b = bucket ?? this.defaultBucket();
    return this.provider.list(b, options.prefix, options.maxKeys);
  }

  /**
   * Copy an object (within or across buckets, if provider supports it).
   */
  async copy(
    sourceKey: string,
    destKey: string,
    sourceBucket?: string,
    destBucket?: string,
  ): Promise<void> {
    const sb = sourceBucket ?? this.defaultBucket();
    const db = destBucket ?? this.defaultBucket();
    await this.provider.copy(sb, sourceKey, db, destKey);
    log.info('Object copied', { sourceKey, destKey });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private defaultBucket(): string {
    const { provider } = config.storage;
    if (provider === 's3') return config.aws.bucket || config.storage.defaultBucket;
    if (provider === 'gcs') return config.gcs.bucket || config.storage.defaultBucket;
    if (provider === 'minio') return config.minio.bucket || config.storage.defaultBucket;
    return config.storage.defaultBucket;
  }

  private validateUpload(input: UploadFileInput): void {
    const { contentType, buffer } = input;
    const allAllowed = [
      ...config.upload.allowedImageTypes,
      ...config.upload.allowedVideoTypes,
      ...config.upload.allowedDocumentTypes,
    ];

    if (!allAllowed.includes(contentType)) {
      throw new UnsupportedMediaTypeError(contentType);
    }

    const sizeMb = buffer.length / (1024 * 1024);
    const isImage = contentType.startsWith('image/');
    const isVideo = contentType.startsWith('video/');

    if (isImage && sizeMb > config.upload.maxImageSizeMb) {
      throw new FileTooLargeError(config.upload.maxImageSizeMb);
    }
    if (isVideo && sizeMb > config.upload.maxVideoSizeMb) {
      throw new FileTooLargeError(config.upload.maxVideoSizeMb);
    }
    if (!isImage && !isVideo && sizeMb > config.upload.maxFileSizeMb) {
      throw new FileTooLargeError(config.upload.maxFileSizeMb);
    }
  }
}
