import { Storage, File } from '@google-cloud/storage';
import {
  IStorageProvider,
  UploadOptions,
  UploadResult,
  PresignedUrlOptions,
} from '../../core/interfaces/IStorageProvider';
import { ObjectListItem } from '../../core/entities/StoredObject';
import { StorageError } from '../../core/errors/AppError';
import { createLogger } from '../../utils/logger';
import { config } from '../../config';

const log = createLogger('GCSProvider');

/**
 * Google Cloud Storage provider.
 */
export class GCSProvider implements IStorageProvider {
  readonly name = 'gcs';

  private readonly client: Storage;

  constructor() {
    const storageOptions: ConstructorParameters<typeof Storage>[0] = {
      projectId: config.gcs.projectId || undefined,
    };

    if (config.gcs.keyFile) {
      storageOptions.keyFilename = config.gcs.keyFile;
    }

    this.client = new Storage(storageOptions);
    log.info('GCSProvider initialised', { projectId: config.gcs.projectId });
  }

  async upload(
    bucket: string,
    key: string,
    buffer: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    try {
      const file = this.client.bucket(bucket).file(key);
      await file.save(buffer, {
        contentType: options.contentType,
        metadata: { metadata: options.metadata },
        resumable: buffer.length > 5 * 1024 * 1024, // resumable upload for >5 MB
      });

      const [metadata] = await file.getMetadata();
      log.info('GCS upload complete', { bucket, key });

      return {
        key,
        bucket,
        etag: metadata.etag as string | undefined,
        location: `https://storage.googleapis.com/${bucket}/${key}`,
      };
    } catch (err) {
      log.error('GCS upload failed', { bucket, key, err });
      throw new StorageError(`GCS upload failed for key '${key}'`, err);
    }
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    try {
      const [buffer] = await this.client.bucket(bucket).file(key).download();
      return buffer;
    } catch (err) {
      log.error('GCS download failed', { bucket, key, err });
      throw new StorageError(`GCS download failed for key '${key}'`, err);
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.bucket(bucket).file(key).delete();
      log.info('GCS object deleted', { bucket, key });
    } catch (err) {
      log.error('GCS delete failed', { bucket, key, err });
      throw new StorageError(`GCS delete failed for key '${key}'`, err);
    }
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    options: PresignedUrlOptions = {},
  ): Promise<string> {
    try {
      const expiresIn = options.expiresIn ?? config.storage.presignedUrlTtl;
      const [url] = await this.client
        .bucket(bucket)
        .file(key)
        .getSignedUrl({
          action: 'read',
          expires: Date.now() + expiresIn * 1000,
        });
      return url;
    } catch (err) {
      throw new StorageError(`GCS presigned URL generation failed for '${key}'`, err);
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      const [exists] = await this.client.bucket(bucket).file(key).exists();
      return exists;
    } catch (err) {
      throw new StorageError(`GCS exists check failed for '${key}'`, err);
    }
  }

  async list(bucket: string, prefix?: string, maxKeys = 1000): Promise<ObjectListItem[]> {
    try {
      const [files] = await this.client.bucket(bucket).getFiles({
        prefix,
        maxResults: maxKeys,
      });

      return files.map((file: File) => ({
        key: file.name,
        size: parseInt(file.metadata.size as string, 10) || 0,
        lastModified: new Date(file.metadata.updated as string),
        etag: file.metadata.etag as string | undefined,
      }));
    } catch (err) {
      throw new StorageError('GCS list failed', err);
    }
  }

  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void> {
    try {
      const sourceFile = this.client.bucket(sourceBucket).file(sourceKey);
      const destFile = this.client.bucket(destBucket).file(destKey);
      await sourceFile.copy(destFile);
    } catch (err) {
      throw new StorageError(`GCS copy failed from '${sourceKey}' to '${destKey}'`, err);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const bucket = config.gcs.bucket || config.storage.defaultBucket;
      const [exists] = await this.client.bucket(bucket).exists();
      return exists;
    } catch {
      return false;
    }
  }
}
