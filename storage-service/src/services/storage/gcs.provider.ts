/**
 * Google Cloud Storage provider.
 *
 * Authenticates via service-account key file (GCS_KEY_FILE) or
 * base64-encoded JSON credentials (GCS_CREDENTIALS_BASE64).
 * Falls back to Application Default Credentials (ADC) when neither is set.
 */

import { Storage, Bucket, GetSignedUrlConfig } from '@google-cloud/storage';
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
import { gcsConfig, storageConfig } from '../../config';
import logger from '../../utils/logger';
import { NotFoundError, StorageError } from '../../utils/errors';

export class GcsProvider implements IStorageProvider {
  private readonly storage: Storage;
  private readonly defaultBucketName: string;

  constructor() {
    let credentials: object | undefined;

    if (gcsConfig.credentialsBase64) {
      credentials = JSON.parse(Buffer.from(gcsConfig.credentialsBase64, 'base64').toString('utf-8')) as object;
    }

    this.storage = new Storage({
      projectId: gcsConfig.projectId,
      keyFilename: gcsConfig.keyFile,
      credentials,
    });

    this.defaultBucketName = gcsConfig.bucket;
  }

  private bucket(name?: string): Bucket {
    return this.storage.bucket(name ?? this.defaultBucketName);
  }

  // ─── Upload ────────────────────────────────────────────────────────────────

  async upload(
    key: string,
    body: Readable | Buffer | string,
    mimeType: string,
    options: UploadOptions = {},
  ): Promise<string> {
    const bkt = this.bucket(options.bucket);
    const file = bkt.file(key);

    try {
      const writeStream = file.createWriteStream({
        metadata: {
          contentType: mimeType,
          metadata: options.metadata,
        },
        resumable: false,
      });

      await new Promise<void>((resolve, reject) => {
        if (body instanceof Readable) {
          body.pipe(writeStream).on('error', reject).on('finish', resolve);
        } else {
          writeStream.end(body, () => resolve());
          writeStream.on('error', reject);
        }
      });

      logger.info('GCS: object uploaded', { bucket: bkt.name, key });
      return key;
    } catch (err) {
      throw new StorageError(`GCS upload failed for key "${key}"`, err);
    }
  }

  // ─── Download ──────────────────────────────────────────────────────────────

  async download(key: string, options: DownloadOptions = {}): Promise<Readable> {
    const bkt = this.bucket(options.bucket);
    try {
      const [exists] = await bkt.file(key).exists();
      if (!exists) throw new NotFoundError(`Object not found: ${key}`);
      return bkt.file(key).createReadStream();
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      throw new StorageError(`GCS download failed for key "${key}"`, err);
    }
  }

  // ─── Presigned URL ─────────────────────────────────────────────────────────

  async getPresignedUrl(key: string, options: DownloadOptions = {}): Promise<string> {
    const bkt = this.bucket(options.bucket);
    const expiresIn = options.expiresIn ?? storageConfig.presignedUrlTtl;
    const config: GetSignedUrlConfig = {
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    };
    try {
      const [url] = await bkt.file(key).getSignedUrl(config);
      return url;
    } catch (err) {
      throw new StorageError(`GCS presigned URL failed for key "${key}"`, err);
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async delete(key: string, bucket?: string): Promise<void> {
    try {
      await this.bucket(bucket).file(key).delete();
      logger.info('GCS: object deleted', { bucket: bucket ?? this.defaultBucketName, key });
    } catch (err) {
      throw new StorageError(`GCS delete failed for key "${key}"`, err);
    }
  }

  async deleteMany(keys: string[], bucket?: string): Promise<void> {
    await Promise.all(keys.map((k) => this.delete(k, bucket)));
  }

  // ─── Exists ────────────────────────────────────────────────────────────────

  async exists(key: string, bucket?: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket(bucket).file(key).exists();
      return exists;
    } catch {
      return false;
    }
  }

  // ─── Metadata ──────────────────────────────────────────────────────────────

  async getMetadata(key: string, bucket?: string): Promise<Partial<FileMetadata>> {
    const bkt = this.bucket(bucket);
    try {
      const [meta] = await bkt.file(key).getMetadata();
      return {
        key,
        bucket: bkt.name,
        mimeType: (meta.contentType as string | undefined) ?? 'application/octet-stream',
        size: parseInt(String(meta.size ?? '0'), 10),
        provider: 'gcs' as StorageProvider,
        uploadedAt: (meta.timeCreated as string | undefined) ?? new Date().toISOString(),
      };
    } catch (err) {
      throw new StorageError(`GCS getMetadata failed for key "${key}"`, err);
    }
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async list(options: ListOptions = {}): Promise<ListResult> {
    const bkt = this.bucket(options.bucket);
    try {
      const [files, , { nextPageToken }] = await bkt.getFiles({
        prefix: options.prefix,
        maxResults: options.maxKeys ?? 100,
        pageToken: options.continuationToken,
      });
      const fileMetadata: FileMetadata[] = files.map((f) => ({
        id: f.name,
        originalName: f.name.split('/').pop() ?? f.name,
        key: f.name,
        mimeType: 'application/octet-stream',
        size: parseInt(String(f.metadata.size ?? '0'), 10),
        category: 'other' as const,
        bucket: bkt.name,
        provider: 'gcs' as StorageProvider,
        uploadedAt: (f.metadata.timeCreated as string | undefined) ?? new Date().toISOString(),
      }));
      return {
        files: fileMetadata,
        nextContinuationToken: nextPageToken as string | undefined,
        isTruncated: !!nextPageToken,
      };
    } catch (err) {
      throw new StorageError('GCS list failed', err);
    }
  }

  // ─── Copy ──────────────────────────────────────────────────────────────────

  async copy(
    sourceKey: string,
    destinationKey: string,
    sourceBucket?: string,
    destinationBucket?: string,
  ): Promise<void> {
    const srcFile = this.bucket(sourceBucket).file(sourceKey);
    const dstFile = this.bucket(destinationBucket).file(destinationKey);
    try {
      await srcFile.copy(dstFile);
    } catch (err) {
      throw new StorageError(`GCS copy failed: ${sourceKey} → ${destinationKey}`, err);
    }
  }

  // ─── Ensure Bucket ─────────────────────────────────────────────────────────

  async ensureBucket(bucket: string): Promise<void> {
    try {
      const bkt = this.storage.bucket(bucket);
      const [exists] = await bkt.exists();
      if (!exists) {
        await bkt.create();
        logger.info('GCS: bucket created', { bucket });
      }
    } catch (err) {
      throw new StorageError(`GCS ensureBucket failed for "${bucket}"`, err);
    }
  }

  // ─── Health Check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      const [exists] = await this.bucket().exists();
      return exists;
    } catch {
      return false;
    }
  }
}
