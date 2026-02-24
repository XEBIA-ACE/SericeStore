/**
 * FileService — orchestrates upload, download, listing, deletion, and
 * media-processing pipelines.
 *
 * This is the single entry-point for all business logic; it depends on
 * IStorageProvider, IImageProcessor, and IVideoProcessor via constructor
 * injection so it is easy to test with mocks.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

import { IStorageProvider } from '../core/interfaces/storage.interface';
import { IImageProcessor, IVideoProcessor } from '../core/interfaces/processor.interface';
import {
  DownloadOptions,
  FileCategory,
  FileMetadata,
  ImageProcessingOptions,
  ListOptions,
  ListResult,
  ProcessingResult,
  StorageProvider,
  UploadOptions,
  VideoProcessingOptions,
} from '../core/types';
import { imageConfig, storageConfig, videoConfig } from '../config';
import logger from '../utils/logger';
import { resolveFileCategory, sanitiseKey } from '../utils/validators';
import {
  FileTooLargeError,
  NotFoundError,
  ProcessingError,
  UnsupportedMediaTypeError,
} from '../utils/errors';

export class FileService {
  constructor(
    private readonly storage: IStorageProvider,
    private readonly imageProcessor: IImageProcessor,
    private readonly videoProcessor: IVideoProcessor,
  ) {}

  // ─── Upload ────────────────────────────────────────────────────────────────

  /**
   * Upload a file (stream or buffer), optionally triggering media processing.
   * Returns the full FileMetadata record.
   */
  async uploadFile(
    originalName: string,
    mimeType: string,
    fileSize: number,
    body: Readable | Buffer,
    options: UploadOptions & {
      imageOptions?: ImageProcessingOptions;
      videoOptions?: VideoProcessingOptions;
    } = {},
  ): Promise<FileMetadata> {
    // ── Validation ─────────────────────────────────────────────────────────
    if (fileSize > storageConfig.maxFileSizeBytes) {
      throw new FileTooLargeError(storageConfig.maxFileSizeBytes);
    }
    if (!this.isMimeAllowed(mimeType)) {
      throw new UnsupportedMediaTypeError(mimeType);
    }

    const id = uuidv4();
    const category = resolveFileCategory(mimeType);
    const ext = path.extname(originalName) || '';
    const safeKey = options.key
      ? sanitiseKey(options.key)
      : `${category}s/${id}${ext}`;

    // ── Store raw file ─────────────────────────────────────────────────────
    await this.storage.upload(safeKey, body, mimeType, options);

    // ── Media processing (best-effort) ─────────────────────────────────────
    let processing: ProcessingResult = { status: 'pending' };

    const shouldProcess =
      options.processMedia !== false &&
      (category === 'image' || category === 'video');

    if (shouldProcess) {
      try {
        processing = await this.processMedia(safeKey, mimeType, category, options);
      } catch (err) {
        // Non-fatal: record the error but do not reject the upload
        logger.warn('Media processing failed — continuing without processed assets', {
          key: safeKey,
          error: String(err),
        });
        processing = {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      processing = { status: 'completed' };
    }

    const metadata: FileMetadata = {
      id,
      originalName,
      key: safeKey,
      mimeType,
      size: fileSize,
      category,
      bucket: options.bucket ?? storageConfig.provider,
      provider: storageConfig.provider as StorageProvider,
      uploadedAt: new Date().toISOString(),
      uploadedBy: options.uploadedBy,
      tags: options.tags,
      processing,
    };

    logger.info('File uploaded successfully', { id, key: safeKey, mimeType, size: fileSize });
    return metadata;
  }

  // ─── Download ──────────────────────────────────────────────────────────────

  async downloadFile(key: string, options?: DownloadOptions): Promise<Readable> {
    const exists = await this.storage.exists(key, options?.bucket);
    if (!exists) throw new NotFoundError(`File not found: ${key}`);
    return this.storage.download(key, options);
  }

  // ─── Presigned URL ─────────────────────────────────────────────────────────

  async getPresignedUrl(key: string, options?: DownloadOptions): Promise<string> {
    const exists = await this.storage.exists(key, options?.bucket);
    if (!exists) throw new NotFoundError(`File not found: ${key}`);
    return this.storage.getPresignedUrl(key, options);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async deleteFile(key: string, bucket?: string): Promise<void> {
    const exists = await this.storage.exists(key, bucket);
    if (!exists) throw new NotFoundError(`File not found: ${key}`);
    await this.storage.delete(key, bucket);
    logger.info('File deleted', { key, bucket });
  }

  async deleteFiles(keys: string[], bucket?: string): Promise<void> {
    await this.storage.deleteMany(keys, bucket);
    logger.info('Batch delete complete', { count: keys.length });
  }

  // ─── Metadata ──────────────────────────────────────────────────────────────

  async getFileMetadata(key: string, bucket?: string): Promise<Partial<FileMetadata>> {
    return this.storage.getMetadata(key, bucket);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async listFiles(options?: ListOptions): Promise<ListResult> {
    return this.storage.list(options);
  }

  // ─── Copy ──────────────────────────────────────────────────────────────────

  async copyFile(
    sourceKey: string,
    destinationKey: string,
    sourceBucket?: string,
    destinationBucket?: string,
  ): Promise<void> {
    await this.storage.copy(sourceKey, destinationKey, sourceBucket, destinationBucket);
    logger.info('File copied', { sourceKey, destinationKey });
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<{
    storage: boolean;
    imageProcessor: boolean;
    videoProcessor: boolean;
  }> {
    const [storage, imageProcessor, videoProcessor] = await Promise.all([
      this.storage.healthCheck(),
      imageConfig.enabled ? this.imageProcessor.healthCheck() : Promise.resolve(true),
      videoConfig.enabled ? this.videoProcessor.healthCheck() : Promise.resolve(true),
    ]);
    return { storage, imageProcessor, videoProcessor };
  }

  // ─── Private: Media Processing ─────────────────────────────────────────────

  private async processMedia(
    key: string,
    mimeType: string,
    category: FileCategory,
    options: {
      imageOptions?: ImageProcessingOptions;
      videoOptions?: VideoProcessingOptions;
      bucket?: string;
    },
  ): Promise<ProcessingResult> {
    // Download to a local temp file for processing
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-svc-'));
    const ext = mimeType.split('/')[1] ?? 'bin';
    const tmpInput = path.join(tmpDir, `input.${ext}`);

    try {
      const stream = await this.storage.download(key, { bucket: options.bucket });
      await this.pipeToFile(stream, tmpInput);

      if (category === 'image' && imageConfig.enabled) {
        return await this.processImage(tmpInput, tmpDir, key, options);
      }

      if (category === 'video' && videoConfig.enabled) {
        return await this.processVideo(tmpInput, tmpDir, key, options);
      }

      return { status: 'completed' };
    } finally {
      // Clean up temp files regardless of success/failure
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private async processImage(
    tmpInput: string,
    tmpDir: string,
    originalKey: string,
    options: { imageOptions?: ImageProcessingOptions; bucket?: string },
  ): Promise<ProcessingResult> {
    const imgOpts: ImageProcessingOptions = {
      generateThumbnail: true,
      quality: imageConfig.defaultQuality,
      thumbnailWidth: imageConfig.thumbnailWidth,
      thumbnailHeight: imageConfig.thumbnailHeight,
      stripMetadata: true,
      ...options.imageOptions,
    };

    const result = await this.imageProcessor.process(tmpInput, tmpDir, imgOpts);

    let thumbnailKey: string | undefined;
    let thumbnailUrl: string | undefined;

    if (result.thumbnailPath && fs.existsSync(result.thumbnailPath)) {
      thumbnailKey = `${originalKey}-thumb${path.extname(result.thumbnailPath)}`;
      const thumbStream = fs.createReadStream(result.thumbnailPath);
      await this.storage.upload(thumbnailKey, thumbStream, 'image/jpeg', {
        bucket: options.bucket,
      });
      thumbnailUrl = await this.storage.getPresignedUrl(thumbnailKey, { bucket: options.bucket });
    }

    return {
      status: 'completed',
      thumbnailKey,
      thumbnailUrl,
      width: result.width,
      height: result.height,
    };
  }

  private async processVideo(
    tmpInput: string,
    tmpDir: string,
    originalKey: string,
    options: { videoOptions?: VideoProcessingOptions; bucket?: string },
  ): Promise<ProcessingResult> {
    const vidOpts: VideoProcessingOptions = {
      generateThumbnail: true,
      thumbnailSecond: videoConfig.thumbnailSecond,
      ...options.videoOptions,
    };

    const result = await this.videoProcessor.process(tmpInput, tmpDir, vidOpts);

    let thumbnailKey: string | undefined;
    let thumbnailUrl: string | undefined;

    if (result.thumbnailPath && fs.existsSync(result.thumbnailPath)) {
      thumbnailKey = `${originalKey}-thumb.jpg`;
      const thumbStream = fs.createReadStream(result.thumbnailPath);
      await this.storage.upload(thumbnailKey, thumbStream, 'image/jpeg', {
        bucket: options.bucket,
      });
      thumbnailUrl = await this.storage.getPresignedUrl(thumbnailKey, { bucket: options.bucket });
    }

    return {
      status: 'completed',
      thumbnailKey,
      thumbnailUrl,
      width: result.width,
      height: result.height,
      duration: result.duration,
    };
  }

  // ─── Private: Stream Helper ────────────────────────────────────────────────

  private pipeToFile(stream: Readable, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      stream.on('error', reject);
    });
  }

  // ─── Private: MIME Validation ──────────────────────────────────────────────

  private isMimeAllowed(mimeType: string): boolean {
    return [
      ...storageConfig.allowedImageTypes,
      ...storageConfig.allowedVideoTypes,
      ...storageConfig.allowedDocumentTypes,
    ].includes(mimeType);
  }
}
