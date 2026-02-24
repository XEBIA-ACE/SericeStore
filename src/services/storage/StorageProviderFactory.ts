import { IStorageProvider } from '../../core/interfaces/IStorageProvider';
import { StorageError } from '../../core/errors/AppError';
import { Config } from '../../config';
import { S3StorageProvider } from './providers/S3StorageProvider';
import { GCSStorageProvider } from './providers/GCSStorageProvider';
import { MinIOStorageProvider } from './providers/MinIOStorageProvider';

/**
 * Creates the appropriate IStorageProvider based on the STORAGE_PROVIDER
 * environment variable.  All provider-specific configuration is read here,
 * keeping the rest of the application decoupled from provider details.
 */
export function createStorageProvider(config: Config): IStorageProvider {
  switch (config.STORAGE_PROVIDER) {
    case 's3': {
      if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY || !config.AWS_S3_BUCKET) {
        throw new StorageError(
          'S3 provider requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET',
        );
      }
      return new S3StorageProvider({
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        region: config.AWS_REGION,
        bucket: config.AWS_S3_BUCKET,
        endpoint: config.AWS_S3_ENDPOINT || undefined,
      });
    }

    case 'gcs': {
      if (!config.GCS_PROJECT_ID || !config.GCS_BUCKET) {
        throw new StorageError('GCS provider requires GCS_PROJECT_ID and GCS_BUCKET');
      }
      return new GCSStorageProvider({
        projectId: config.GCS_PROJECT_ID,
        bucket: config.GCS_BUCKET,
        keyFilename: config.GCS_KEY_FILE || undefined,
      });
    }

    case 'minio': {
      return new MinIOStorageProvider({
        endpoint: config.MINIO_ENDPOINT,
        port: config.MINIO_PORT,
        useSSL: config.MINIO_USE_SSL,
        accessKey: config.MINIO_ACCESS_KEY,
        secretKey: config.MINIO_SECRET_KEY,
        bucket: config.MINIO_BUCKET,
      });
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = config.STORAGE_PROVIDER;
      throw new StorageError(`Unknown storage provider: ${String(_exhaustive)}`);
    }
  }
}
