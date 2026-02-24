/**
 * StorageFactory — selects and instantiates the correct storage provider
 * based on the STORAGE_PROVIDER environment variable.
 *
 * Providers are singletons within a process lifetime.
 */

import { IStorageProvider } from '../../core/interfaces/storage.interface';
import { StorageProvider } from '../../core/types';
import { storageConfig } from '../../config';
import logger from '../../utils/logger';

let _instance: IStorageProvider | null = null;

export function getStorageProvider(provider?: StorageProvider): IStorageProvider {
  if (_instance) return _instance;

  const selected = provider ?? storageConfig.provider;

  switch (selected) {
    case 's3': {
      // Lazy require keeps unused provider SDKs out of the critical path
      const { S3Provider } = require('./s3.provider') as { S3Provider: new () => IStorageProvider };
      _instance = new S3Provider();
      break;
    }
    case 'gcs': {
      const { GcsProvider } = require('./gcs.provider') as { GcsProvider: new () => IStorageProvider };
      _instance = new GcsProvider();
      break;
    }
    case 'minio': {
      const { MinioProvider } = require('./minio.provider') as { MinioProvider: new () => IStorageProvider };
      _instance = new MinioProvider();
      break;
    }
    default:
      throw new Error(`Unknown storage provider: "${String(selected)}". Valid options: s3, gcs, minio`);
  }

  logger.info(`Storage provider initialised: ${selected}`);
  return _instance;
}

/** Reset singleton — intended for testing only. */
export function resetStorageProvider(): void {
  _instance = null;
}
