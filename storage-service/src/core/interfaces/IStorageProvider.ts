import { ObjectListItem } from '../entities/StoredObject';

/**
 * Options for uploading an object.
 */
export interface UploadOptions {
  contentType: string;
  metadata?: Record<string, string>;
  /** ACL / access policy (provider-specific) */
  acl?: string;
}

/**
 * Options when generating a presigned URL.
 */
export interface PresignedUrlOptions {
  /** TTL in seconds (default: 3600) */
  expiresIn?: number;
}

/**
 * Result of a successful upload.
 */
export interface UploadResult {
  key: string;
  bucket: string;
  etag?: string;
  location?: string;
}

/**
 * Port (interface) that every storage provider must implement.
 * Allows swapping S3 ↔ GCS ↔ MinIO without touching business logic.
 */
export interface IStorageProvider {
  /** Provider identifier */
  readonly name: string;

  /**
   * Upload a file buffer to the storage backend.
   */
  upload(
    bucket: string,
    key: string,
    buffer: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult>;

  /**
   * Download an object as a Buffer.
   */
  download(bucket: string, key: string): Promise<Buffer>;

  /**
   * Delete an object.
   */
  delete(bucket: string, key: string): Promise<void>;

  /**
   * Generate a pre-signed URL for temporary GET access.
   */
  getPresignedUrl(
    bucket: string,
    key: string,
    options?: PresignedUrlOptions,
  ): Promise<string>;

  /**
   * Check whether an object exists.
   */
  exists(bucket: string, key: string): Promise<boolean>;

  /**
   * List objects with an optional key prefix.
   */
  list(bucket: string, prefix?: string, maxKeys?: number): Promise<ObjectListItem[]>;

  /**
   * Copy an object within the same bucket (or cross-bucket if supported).
   */
  copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void>;

  /**
   * Health-check: verify the backend is reachable.
   */
  healthCheck(): Promise<boolean>;
}
