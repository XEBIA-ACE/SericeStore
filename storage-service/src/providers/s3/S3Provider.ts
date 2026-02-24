import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
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

const log = createLogger('S3Provider');

/**
 * AWS S3 storage provider.
 * Also compatible with S3-compatible APIs (e.g. Cloudflare R2, Backblaze B2).
 */
export class S3Provider implements IStorageProvider {
  readonly name = 's3';

  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: config.aws.region,
      credentials:
        config.aws.accessKeyId && config.aws.secretAccessKey
          ? {
              accessKeyId: config.aws.accessKeyId,
              secretAccessKey: config.aws.secretAccessKey,
            }
          : undefined, // falls back to IAM role / instance profile
      endpoint: config.aws.endpoint || undefined,
      forcePathStyle: !!config.aws.endpoint, // required for MinIO-style endpoints
    });

    log.info('S3Provider initialised', { region: config.aws.region });
  }

  async upload(
    bucket: string,
    key: string,
    buffer: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: options.contentType,
          Metadata: options.metadata,
          ACL: options.acl as never, // typed loosely to avoid SDK enum import
        },
      });

      const result = await upload.done();
      log.info('S3 upload complete', { bucket, key, etag: result.ETag });

      return {
        key,
        bucket,
        etag: result.ETag,
        location: result.Location,
      };
    } catch (err) {
      log.error('S3 upload failed', { bucket, key, err });
      throw new StorageError(`S3 upload failed for key '${key}'`, err);
    }
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const response = await this.client.send(command);

      if (!response.Body) throw new Error('Empty response body');

      return streamToBuffer(response.Body as Readable);
    } catch (err) {
      log.error('S3 download failed', { bucket, key, err });
      throw new StorageError(`S3 download failed for key '${key}'`, err);
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      log.info('S3 object deleted', { bucket, key });
    } catch (err) {
      log.error('S3 delete failed', { bucket, key, err });
      throw new StorageError(`S3 delete failed for key '${key}'`, err);
    }
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    options: PresignedUrlOptions = {},
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(this.client, command, {
        expiresIn: options.expiresIn ?? config.storage.presignedUrlTtl,
      });
      return url;
    } catch (err) {
      throw new StorageError(`S3 presigned URL generation failed for '${key}'`, err);
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      if (isNotFoundError(err)) return false;
      throw new StorageError(`S3 exists check failed for '${key}'`, err);
    }
  }

  async list(bucket: string, prefix?: string, maxKeys = 1000): Promise<ObjectListItem[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      });
      const response = await this.client.send(command);

      return (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
        etag: obj.ETag,
      }));
    } catch (err) {
      throw new StorageError('S3 list failed', err);
    }
  }

  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          CopySource: `${sourceBucket}/${sourceKey}`,
          Bucket: destBucket,
          Key: destKey,
        }),
      );
    } catch (err) {
      throw new StorageError(`S3 copy failed from '${sourceKey}' to '${destKey}'`, err);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: config.aws.bucket || config.storage.defaultBucket }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

function isNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const name = (err as { name?: string }).name ?? '';
    return name === 'NotFound' || name === 'NoSuchKey';
  }
  return false;
}
