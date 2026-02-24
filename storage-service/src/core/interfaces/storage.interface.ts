import { Readable } from 'stream';
import {
  DownloadOptions,
  FileMetadata,
  ListOptions,
  ListResult,
  UploadOptions,
} from '../types';

/**
 * IStorageProvider — contract every cloud-storage backend must satisfy.
 *
 * Implementations live in src/services/storage/ and are wired via the
 * StorageFactory.  Business logic only ever depends on this interface.
 */
export interface IStorageProvider {
  /**
   * Upload a file stream or buffer.
   * @param key      Object key (path inside the bucket)
   * @param body     File content – stream, Buffer, or string
   * @param mimeType MIME type of the file
   * @param options  Upload options (bucket override, metadata, etc.)
   * @returns        Persisted object key
   */
  upload(
    key: string,
    body: Readable | Buffer | string,
    mimeType: string,
    options?: UploadOptions,
  ): Promise<string>;

  /**
   * Download a file as a readable stream.
   */
  download(key: string, options?: DownloadOptions): Promise<Readable>;

  /**
   * Generate a time-limited presigned URL for direct client access.
   */
  getPresignedUrl(key: string, options?: DownloadOptions): Promise<string>;

  /**
   * Delete a single object.
   */
  delete(key: string, bucket?: string): Promise<void>;

  /**
   * Delete multiple objects in one call (batch).
   */
  deleteMany(keys: string[], bucket?: string): Promise<void>;

  /**
   * Check whether an object exists.
   */
  exists(key: string, bucket?: string): Promise<boolean>;

  /**
   * Retrieve object metadata without downloading the body.
   */
  getMetadata(key: string, bucket?: string): Promise<Partial<FileMetadata>>;

  /**
   * List objects, optionally filtered by prefix.
   */
  list(options?: ListOptions): Promise<ListResult>;

  /**
   * Copy an object within (or across) buckets.
   */
  copy(sourceKey: string, destinationKey: string, sourceBucket?: string, destinationBucket?: string): Promise<void>;

  /**
   * Ensure the bucket exists; create it if it does not.
   */
  ensureBucket(bucket: string): Promise<void>;

  /**
   * Health-check — verify provider connectivity.
   */
  healthCheck(): Promise<boolean>;
}
