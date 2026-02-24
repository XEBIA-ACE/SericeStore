/**
 * MinIOStorageProvider
 *
 * MinIO is S3-compatible, so we reuse the S3StorageProvider under the hood
 * but apply the MinIO-specific defaults (path-style URLs, configurable endpoint/port).
 */
import { Readable } from 'stream';
import { S3StorageProvider } from './S3StorageProvider';
import {
  IStorageProvider,
  StorageObject,
  UploadOptions,
  PresignOptions,
  StorageListResult,
} from '../../../core/interfaces/IStorageProvider';
import { logger } from '../../../utils/logger';

export interface MinIOProviderConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export class MinIOStorageProvider implements IStorageProvider {
  public readonly providerName = 'minio';
  private readonly delegate: S3StorageProvider;

  constructor(cfg: MinIOProviderConfig) {
    const protocol = cfg.useSSL ? 'https' : 'http';
    const endpointUrl = `${protocol}://${cfg.endpoint}:${cfg.port}`;

    logger.debug(`MinIO endpoint: ${endpointUrl}, bucket: ${cfg.bucket}`);

    this.delegate = new S3StorageProvider({
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
      // MinIO ignores the region but AWS SDK requires a non-empty value
      region: 'us-east-1',
      bucket: cfg.bucket,
      endpoint: endpointUrl,
      // MinIO requires path-style addressing
      forcePathStyle: true,
    });
  }

  async initialize(): Promise<void> {
    return this.delegate.initialize();
  }

  async upload(key: string, data: Buffer | Readable, options: UploadOptions): Promise<StorageObject> {
    return this.delegate.upload(key, data, options);
  }

  async download(key: string): Promise<Readable> {
    return this.delegate.download(key);
  }

  async getMetadata(key: string): Promise<StorageObject> {
    return this.delegate.getMetadata(key);
  }

  async delete(key: string): Promise<void> {
    return this.delegate.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.delegate.exists(key);
  }

  async copy(sourceKey: string, destinationKey: string): Promise<StorageObject> {
    return this.delegate.copy(sourceKey, destinationKey);
  }

  async getPresignedUrl(key: string, options?: PresignOptions): Promise<string> {
    return this.delegate.getPresignedUrl(key, options);
  }

  async list(prefix?: string, cursor?: string, limit?: number): Promise<StorageListResult> {
    return this.delegate.list(prefix, cursor, limit);
  }
}
