import { Readable } from 'stream';

/**
 * Metadata returned when a file is stored or retrieved.
 */
export interface StorageObject {
  /** Storage key / path of the object */
  key: string;
  /** Size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** ETag or version identifier */
  etag?: string;
  /** ISO-8601 last-modified timestamp */
  lastModified?: string;
  /** Arbitrary key-value metadata stored alongside the object */
  metadata?: Record<string, string>;
}

/**
 * Options for uploading an object to the storage backend.
 */
export interface UploadOptions {
  contentType: string;
  metadata?: Record<string, string>;
  /** Canned ACL (e.g. 'public-read').  Provider-specific; silently ignored if unsupported. */
  acl?: string;
}

/**
 * Options for generating a pre-signed URL.
 */
export interface PresignOptions {
  /** Expiry in seconds (default: 3600) */
  expiresIn?: number;
  /** HTTP method the URL should permit ('GET' | 'PUT') */
  method?: 'GET' | 'PUT';
}

/**
 * A single item in a paginated list response.
 */
export interface StorageListItem {
  key: string;
  size: number;
  lastModified?: string;
}

/**
 * Paginated list result.
 */
export interface StorageListResult {
  items: StorageListItem[];
  /** Opaque cursor token for the next page; undefined when there are no more results */
  nextCursor?: string;
  isTruncated: boolean;
}

/**
 * Contract that every storage-backend adapter must implement.
 * Concrete implementations: S3StorageProvider, GCSStorageProvider, MinIOStorageProvider.
 */
export interface IStorageProvider {
  /** Provider identifier (e.g. 's3', 'gcs', 'minio') */
  readonly providerName: string;

  /** Ensure the underlying bucket/container exists (idempotent) */
  initialize(): Promise<void>;

  /**
   * Upload a file from a Buffer or a Readable stream.
   * Returns the stored object metadata.
   */
  upload(key: string, data: Buffer | Readable, options: UploadOptions): Promise<StorageObject>;

  /** Download an object and return a readable stream */
  download(key: string): Promise<Readable>;

  /** Retrieve metadata for an object without downloading its content */
  getMetadata(key: string): Promise<StorageObject>;

  /** Delete an object */
  delete(key: string): Promise<void>;

  /** Check whether an object exists */
  exists(key: string): Promise<boolean>;

  /** Copy an object within the same bucket */
  copy(sourceKey: string, destinationKey: string): Promise<StorageObject>;

  /** Generate a time-limited URL to access the object */
  getPresignedUrl(key: string, options?: PresignOptions): Promise<string>;

  /** List objects under a prefix with optional pagination */
  list(prefix?: string, cursor?: string, limit?: number): Promise<StorageListResult>;
}
