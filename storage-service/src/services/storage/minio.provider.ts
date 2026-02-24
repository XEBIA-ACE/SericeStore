/**
 * MinIO storage provider.
 *
 * MinIO is S3-compatible but uses its own Node.js client which offers
 * cleaner streaming semantics — preferred for self-hosted deployments.
 */

import * as Minio from 'minio';
import { Readable } from 'stream';
import { IStorageProvider } from '../../core/interfaces/storage.interface';
import {
  DownloadOptions,
  FileMetadata,
  ListOptions,
  ListResult,
  StorageProvider,
  UploadOptions,
} from '../../core/types';
import { minioConfig, storageConfig } from '../../config';
import logger from '../../utils/logger';
import { NotFoundError, StorageError } from '../../utils/errors';

export class MinioProvider implements IStorageProvider {
  private readonly client: Minio.Client;
  private readonly defaultBucket: string;

  constructor() {
    this.client = new Minio.Client({
      endPoint: minioConfig.endpoint,
      port: minioConfig.port,
      useSSL: minioConfig.useSSL,
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey,
    });
    this.defaultBucket = minioConfig.bucket;
  }

  // ─── Upload ────────────────────────────────────────────────────────────────

  async upload(
    key: string,
    body: Readable | Buffer | string,
    mimeType: string,
    options: UploadOptions = {},
  ): Promise<string> {
    const bucket = options.bucket ?? this.defaultBucket;
    const metaData: Minio.ItemBucketMetadata = {
      'Content-Type': mimeType,
      ...options.metadata,
    };

    try {
      if (body instanceof Readable) {
        await this.client.putObject(bucket, key, body, undefined, metaData);
      } else {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        await this.client.putObject(bucket, key, buffer, buffer.length, metaData);
      }
      logger.info('MinIO: object uploaded', { bucket, key });
      return key;
    } catch (err) {
      throw new StorageError(`MinIO upload failed for key "${key}"`, err);
    }
  }

  // ─── Download ──────────────────────────────────────────────────────────────

  async download(key: string, options: DownloadOptions = {}): Promise<Readable> {
    const bucket = options.bucket ?? this.defaultBucket;
    try {
      return await this.client.getObject(bucket, key);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NoSuchKey' || code === 'NotFound') throw new NotFoundError(`Object not found: ${key}`);
      throw new StorageError(`MinIO download failed for key "${key}"`, err);
    }
  }

  // ─── Presigned URL ─────────────────────────────────────────────────────────

  async getPresignedUrl(key: string, options: DownloadOptions = {}): Promise<string> {
    const bucket = options.bucket ?? this.defaultBucket;
    const expiresIn = options.expiresIn ?? storageConfig.presignedUrlTtl;
    try {
      return await this.client.presignedGetObject(bucket, key, expiresIn);
    } catch (err) {
      throw new StorageError(`MinIO presigned URL failed for key "${key}"`, err);
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async delete(key: string, bucket?: string): Promise<void> {
    const b = bucket ?? this.defaultBucket;
    try {
      await this.client.removeObject(b, key);
      logger.info('MinIO: object deleted', { bucket: b, key });
    } catch (err) {
      throw new StorageError(`MinIO delete failed for key "${key}"`, err);
    }
  }

  async deleteMany(keys: string[], bucket?: string): Promise<void> {
    const b = bucket ?? this.defaultBucket;
    try {
      await this.client.removeObjects(b, keys);
      logger.info('MinIO: batch delete', { bucket: b, count: keys.length });
    } catch (err) {
      throw new StorageError('MinIO batch delete failed', err);
    }
  }

  // ─── Exists ────────────────────────────────────────────────────────────────

  async exists(key: string, bucket?: string): Promise<boolean> {
    const b = bucket ?? this.defaultBucket;
    try {
      await this.client.statObject(b, key);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Metadata ──────────────────────────────────────────────────────────────

  async getMetadata(key: string, bucket?: string): Promise<Partial<FileMetadata>> {
    const b = bucket ?? this.defaultBucket;
    try {
      const stat = await this.client.statObject(b, key);
      return {
        key,
        bucket: b,
        mimeType: (stat.metaData['content-type'] as string | undefined) ?? 'application/octet-stream',
        size: stat.size,
        provider: 'minio' as StorageProvider,
        uploadedAt: stat.lastModified.toISOString(),
      };
    } catch (err) {
      throw new StorageError(`MinIO getMetadata failed for key "${key}"`, err);
    }
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async list(options: ListOptions = {}): Promise<ListResult> {
    const bucket = options.bucket ?? this.defaultBucket;
    const maxKeys = options.maxKeys ?? 100;

    return new Promise((resolve, reject) => {
      const files: FileMetadata[] = [];
      const stream = this.client.listObjectsV2(bucket, options.prefix ?? '', true, options.continuationToken);

      stream.on('data', (obj: Minio.BucketItem) => {
        if (files.length < maxKeys) {
          files.push({
            id: obj.name ?? '',
            originalName: (obj.name ?? '').split('/').pop() ?? '',
            key: obj.name ?? '',
            mimeType: 'application/octet-stream',
            size: obj.size,
            category: 'other' as const,
            bucket,
            provider: 'minio' as StorageProvider,
            uploadedAt: obj.lastModified?.toISOString() ?? new Date().toISOString(),
          });
        }
      });

      stream.on('error', (err: Error) => reject(new StorageError('MinIO list failed', err)));

      stream.on('end', () =>
        resolve({
          files,
          isTruncated: false, // MinIO v2 listing doesn't expose truncation in stream mode
        }),
      );
    });
  }

  // ─── Copy ──────────────────────────────────────────────────────────────────

  async copy(
    sourceKey: string,
    destinationKey: string,
    sourceBucket?: string,
    destinationBucket?: string,
  ): Promise<void> {
    const src = sourceBucket ?? this.defaultBucket;
    const dst = destinationBucket ?? this.defaultBucket;
    try {
      const conds = new Minio.CopyConditions();
      await this.client.copyObject(dst, destinationKey, `/${src}/${sourceKey}`, conds);
    } catch (err) {
      throw new StorageError(`MinIO copy failed: ${sourceKey} → ${destinationKey}`, err);
    }
  }

  // ─── Ensure Bucket ─────────────────────────────────────────────────────────

  async ensureBucket(bucket: string): Promise<void> {
    try {
      const exists = await this.client.bucketExists(bucket);
      if (!exists) {
        await this.client.makeBucket(bucket);
        logger.info('MinIO: bucket created', { bucket });
      }
    } catch (err) {
      throw new StorageError(`MinIO ensureBucket failed for "${bucket}"`, err);
    }
  }

  // ─── Health Check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.defaultBucket);
      return true;
    } catch {
      return false;
    }
  }
}
