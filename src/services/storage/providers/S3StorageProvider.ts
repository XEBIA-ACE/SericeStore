import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  PutObjectCommandInput,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export interface S3ProviderConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  /** Override endpoint for S3-compatible services (MinIO, LocalStack, etc.) */
  endpoint?: string;
  /** Force path-style URLs (required by MinIO) */
  forcePathStyle?: boolean;
}

export class S3StorageProvider implements IStorageProvider {
  public readonly providerName = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly cfg: S3ProviderConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      ...(cfg.endpoint && { endpoint: cfg.endpoint }),
      forcePathStyle: cfg.forcePathStyle ?? false,
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      logger.info(`S3 bucket "${this.bucket}" already exists`);
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
        logger.info(`Creating S3 bucket "${this.bucket}"…`);
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } else {
        throw new StorageError('Failed to initialize S3 bucket', err as Error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  async upload(key: string, data: Buffer | Readable, options: UploadOptions): Promise<StorageObject> {
    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: options.contentType,
      Metadata: options.metadata,
      ...(options.acl && { ACL: options.acl as never }),
    };

    try {
      const upload = new Upload({ client: this.client, params: input });
      const result = await upload.done();
      logger.debug(`Uploaded object to S3: ${key}`);

      return {
        key,
        size: Buffer.isBuffer(data) ? data.length : 0,
        contentType: options.contentType,
        etag: result.ETag?.replace(/"/g, ''),
        metadata: options.metadata,
      };
    } catch (err) {
      throw new StorageError(`Failed to upload "${key}" to S3`, err as Error);
    }
  }

  async download(key: string): Promise<Readable> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) throw new StorageError(`Empty body for key "${key}"`);
      return response.Body as Readable;
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === 'NoSuchKey') throw new NotFoundError(`Object "${key}" not found`);
      throw new StorageError(`Failed to download "${key}" from S3`, err as Error);
    }
  }

  async getMetadata(key: string): Promise<StorageObject> {
    try {
      const response: HeadObjectCommandOutput = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        etag: response.ETag?.replace(/"/g, ''),
        lastModified: response.LastModified?.toISOString(),
        metadata: response.Metadata as Record<string, string>,
      };
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === 'NotFound') throw new NotFoundError(`Object "${key}" not found`);
      throw new StorageError(`Failed to get metadata for "${key}"`, err as Error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      logger.debug(`Deleted S3 object: ${key}`);
    } catch (err) {
      throw new StorageError(`Failed to delete "${key}" from S3`, err as Error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<StorageObject> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${sourceKey}`,
          Key: destinationKey,
        }),
      );
      return this.getMetadata(destinationKey);
    } catch (err) {
      throw new StorageError(`Failed to copy "${sourceKey}" → "${destinationKey}"`, err as Error);
    }
  }

  async getPresignedUrl(key: string, options: PresignOptions = {}): Promise<string> {
    const { expiresIn = 3600, method = 'GET' } = options;
    const command =
      method === 'GET'
        ? new GetObjectCommand({ Bucket: this.bucket, Key: key })
        : ({ Bucket: this.bucket, Key: key } as never);

    try {
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (err) {
      throw new StorageError(`Failed to generate pre-signed URL for "${key}"`, err as Error);
    }
  }

  async list(prefix = '', cursor?: string, limit = 100): Promise<StorageListResult> {
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: cursor,
          MaxKeys: limit,
        }),
      );

      return {
        items: (response.Contents ?? []).map((obj) => ({
          key: obj.Key ?? '',
          size: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString(),
        })),
        nextCursor: response.NextContinuationToken,
        isTruncated: response.IsTruncated ?? false,
      };
    } catch (err) {
      throw new StorageError('Failed to list S3 objects', err as Error);
    }
  }
}
