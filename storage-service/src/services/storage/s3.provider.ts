/**
 * Amazon S3 storage provider.
 *
 * Uses AWS SDK v3 (modular).  Supports standard S3 as well as any S3-compatible
 * endpoint (LocalStack, Ceph, etc.) via AWS_S3_ENDPOINT env var.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
import { s3Config, storageConfig } from '../../config';
import logger from '../../utils/logger';
import { StorageError, NotFoundError } from '../../utils/errors';

export class S3Provider implements IStorageProvider {
  private readonly client: S3Client;
  private readonly defaultBucket: string;

  constructor() {
    this.client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      ...(s3Config.endpoint && {
        endpoint: s3Config.endpoint,
        forcePathStyle: s3Config.forcePathStyle,
      }),
    });
    this.defaultBucket = s3Config.bucket;
  }

  // ─── Upload ────────────────────────────────────────────────────────────────

  async upload(
    key: string,
    body: Readable | Buffer | string,
    mimeType: string,
    options: UploadOptions = {},
  ): Promise<string> {
    const bucket = options.bucket ?? this.defaultBucket;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body as Readable | Buffer | string,
          ContentType: mimeType,
          Metadata: options.metadata,
          Tagging: options.tags
            ? Object.entries(options.tags)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                .join('&')
            : undefined,
        }),
      );
      logger.info('S3: object uploaded', { bucket, key });
      return key;
    } catch (err) {
      throw new StorageError(`S3 upload failed for key "${key}"`, err);
    }
  }

  // ─── Download ──────────────────────────────────────────────────────────────

  async download(key: string, options: DownloadOptions = {}): Promise<Readable> {
    const bucket = options.bucket ?? this.defaultBucket;
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!response.Body) throw new StorageError(`Empty body returned for key "${key}"`);
      return response.Body as Readable;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') throw new NotFoundError(`Object not found: ${key}`);
      throw new StorageError(`S3 download failed for key "${key}"`, err);
    }
  }

  // ─── Presigned URL ─────────────────────────────────────────────────────────

  async getPresignedUrl(key: string, options: DownloadOptions = {}): Promise<string> {
    const bucket = options.bucket ?? this.defaultBucket;
    const expiresIn = options.expiresIn ?? storageConfig.presignedUrlTtl;
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn },
      );
    } catch (err) {
      throw new StorageError(`S3 presigned URL generation failed for key "${key}"`, err);
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async delete(key: string, bucket?: string): Promise<void> {
    const b = bucket ?? this.defaultBucket;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: b, Key: key }));
      logger.info('S3: object deleted', { bucket: b, key });
    } catch (err) {
      throw new StorageError(`S3 delete failed for key "${key}"`, err);
    }
  }

  async deleteMany(keys: string[], bucket?: string): Promise<void> {
    const b = bucket ?? this.defaultBucket;
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: b,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      logger.info('S3: batch delete', { bucket: b, count: keys.length });
    } catch (err) {
      throw new StorageError('S3 batch delete failed', err);
    }
  }

  // ─── Exists ────────────────────────────────────────────────────────────────

  async exists(key: string, bucket?: string): Promise<boolean> {
    const b = bucket ?? this.defaultBucket;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: b, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  // ─── Metadata ──────────────────────────────────────────────────────────────

  async getMetadata(key: string, bucket?: string): Promise<Partial<FileMetadata>> {
    const b = bucket ?? this.defaultBucket;
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: b, Key: key }));
      return {
        key,
        bucket: b,
        mimeType: head.ContentType ?? 'application/octet-stream',
        size: head.ContentLength ?? 0,
        provider: 's3' as StorageProvider,
        uploadedAt: head.LastModified?.toISOString() ?? new Date().toISOString(),
      };
    } catch (err) {
      throw new StorageError(`S3 getMetadata failed for key "${key}"`, err);
    }
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async list(options: ListOptions = {}): Promise<ListResult> {
    const bucket = options.bucket ?? this.defaultBucket;
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: options.prefix,
          MaxKeys: options.maxKeys ?? 100,
          ContinuationToken: options.continuationToken,
        }),
      );
      const files: FileMetadata[] = (response.Contents ?? []).map((obj) => ({
        id: obj.Key ?? '',
        originalName: (obj.Key ?? '').split('/').pop() ?? '',
        key: obj.Key ?? '',
        mimeType: 'application/octet-stream',
        size: obj.Size ?? 0,
        category: 'other' as const,
        bucket,
        provider: 's3' as StorageProvider,
        uploadedAt: obj.LastModified?.toISOString() ?? new Date().toISOString(),
      }));
      return {
        files,
        nextContinuationToken: response.NextContinuationToken,
        isTruncated: response.IsTruncated ?? false,
      };
    } catch (err) {
      throw new StorageError('S3 list failed', err);
    }
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
      await this.client.send(
        new CopyObjectCommand({
          Bucket: dst,
          CopySource: `${src}/${sourceKey}`,
          Key: destinationKey,
        }),
      );
    } catch (err) {
      throw new StorageError(`S3 copy failed: ${sourceKey} → ${destinationKey}`, err);
    }
  }

  // ─── Ensure Bucket ─────────────────────────────────────────────────────────

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.info('S3: bucket created', { bucket });
    }
  }

  // ─── Health Check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.defaultBucket }));
      return true;
    } catch {
      return false;
    }
  }
}
