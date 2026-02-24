/**
 * Core domain entity representing a stored object in any storage backend.
 */
export interface StoredObject {
  /** Unique identifier (UUID) */
  id: string;
  /** Original filename as uploaded by the client */
  originalName: string;
  /** Key / path inside the storage bucket */
  key: string;
  /** Bucket name in the storage backend */
  bucket: string;
  /** MIME type */
  contentType: string;
  /** File size in bytes */
  size: number;
  /** Provider that holds this object */
  provider: StorageProvider;
  /** User-defined metadata key/value pairs */
  metadata: Record<string, string>;
  /** ETag returned by the storage backend */
  etag?: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-modified timestamp */
  updatedAt: string;
}

export type StorageProvider = 's3' | 'gcs' | 'minio';

/**
 * Result returned after processing an image.
 */
export interface ProcessedImage {
  /** Key of the processed image */
  key: string;
  /** Key of the generated thumbnail (if any) */
  thumbnailKey?: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Format (jpeg, png, webp, …) */
  format: string;
  /** File size in bytes */
  size: number;
}

/**
 * Result returned after processing a video.
 */
export interface ProcessedVideo {
  /** Key of the transcoded video */
  key: string;
  /** Duration in seconds */
  duration: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Output format */
  format: string;
  /** Codec used */
  codec: string;
  /** File size in bytes */
  size: number;
}

/**
 * Lightweight metadata for listing objects.
 */
export interface ObjectListItem {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}
