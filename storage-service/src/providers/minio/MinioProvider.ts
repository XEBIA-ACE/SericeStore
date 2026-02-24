/**
 * MinIO storage provider.
 *
 * MinIO is API-compatible with AWS S3, so we re-use the S3Provider with custom
 * endpoint/credential configuration pointing to the MinIO instance.
 * This avoids duplicating the AWS SDK logic while keeping a distinct provider class.
 */
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

const log = createLogger('MinioProvider');

export class MinioProvider implements IStorageProvider {
  readonly name = 'minio';

  private readonly client: S3Client;

  constructor() {
    const { endpoint, port, accessKey, secretKey, useSSL } = config.minio;
    const protocol = useSSL ? 'https' : 'http';
    const endpointUrl = `${protocol}://${endpoint}:${port}`;

    this.client = new S3Client({
      endpoint: endpointUrl,
      region: 'us-east-1', // MinIO requires a region string (any value works)
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, // MinIO requires path-style access
    });

    log.info('MinioProvider initialised', { endpoint: endpointUrl });
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
        },
      });
      const result = await upload.done();
      log.info('MinIO upload complete', { bucket, key });
      return { key, bucket, etag: result.ETag };
    } catch (err) {
      log.error('MinIO upload failed', { bucket, key, err });
      throw new StorageError(`MinIO upload failed for key '${key}'`, err);
    }
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!response.Body) throw new Error('Empty response body');
      return streamToBuffer(response.Body as Readable);
    } catch (err) {
      throw new StorageError(`MinIO download failed for key '${key}'`, err);
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      throw new StorageError(`MinIO delete failed for key '${key}'`, err);
    }
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    options: PresignedUrlOptions = {},
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(this.client, command, {
        expiresIn: options.expiresIn ?? config.storage.presignedUrlTtl,
      });
    } catch (err) {
      throw new StorageError(`MinIO presigned URL failed for '${key}'`, err);
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async list(bucket: string, prefix?: string, maxKeys = 1000): Promise<ObjectListItem[]> {
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys }),
      );
      return (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
        etag: obj.ETag,
      }));
    } catch (err) {
      throw new StorageError('MinIO list failed', err);
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
      throw new StorageError(`MinIO copy failed`, err);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: config.minio.bucket }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}
