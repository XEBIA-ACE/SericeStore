import { IStorageProvider } from '../core/interfaces/IStorageProvider';
import { StorageProviderName } from '../config';
import { S3Provider } from './s3/S3Provider';
import { GCSProvider } from './gcs/GCSProvider';
import { MinioProvider } from './minio/MinioProvider';

/**
 * Factory that returns the correct IStorageProvider implementation
 * based on the configured provider name.
 *
 * Providers are lazily instantiated and cached as singletons so that
 * SDK clients (which maintain connection pools) are not re-created per request.
 */
export class StorageProviderFactory {
  private static instances: Partial<Record<StorageProviderName, IStorageProvider>> = {};

  static create(providerName: StorageProviderName): IStorageProvider {
    if (!StorageProviderFactory.instances[providerName]) {
      StorageProviderFactory.instances[providerName] = StorageProviderFactory.build(providerName);
    }
    return StorageProviderFactory.instances[providerName]!;
  }

  private static build(providerName: StorageProviderName): IStorageProvider {
    switch (providerName) {
      case 's3':
        return new S3Provider();
      case 'gcs':
        return new GCSProvider();
      case 'minio':
        return new MinioProvider();
      default:
        throw new Error(`Unknown storage provider: ${String(providerName)}`);
    }
  }
}
