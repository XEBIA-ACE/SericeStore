/**
 * Core domain types shared across layers.
 */

// ─── Storage Provider ─────────────────────────────────────────────────────────

export type StorageProvider = 's3' | 'gcs' | 'minio';

// ─── File Category ────────────────────────────────────────────────────────────

export type FileCategory = 'image' | 'video' | 'document' | 'other';

// ─── File Metadata ────────────────────────────────────────────────────────────

export interface FileMetadata {
  /** Unique file identifier (UUID) */
  id: string;
  /** Original file name as uploaded */
  originalName: string;
  /** Stored object key inside the bucket */
  key: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Resolved file category */
  category: FileCategory;
  /** Storage bucket name */
  bucket: string;
  /** Active storage provider */
  provider: StorageProvider;
  /** ISO-8601 upload timestamp */
  uploadedAt: string;
  /** Optional user / tenant identifier */
  uploadedBy?: string;
  /** Arbitrary key-value tags */
  tags?: Record<string, string>;
  /** Processing results (thumbnails, variants, etc.) */
  processing?: ProcessingResult;
}

// ─── Upload Options ───────────────────────────────────────────────────────────

export interface UploadOptions {
  /** Target bucket; falls back to provider default */
  bucket?: string;
  /** Explicit object key; auto-generated if omitted */
  key?: string;
  /** Arbitrary key-value metadata to attach */
  metadata?: Record<string, string>;
  /** Whether to run media processing pipelines after upload */
  processMedia?: boolean;
  /** Uploader identity */
  uploadedBy?: string;
  /** Arbitrary tags */
  tags?: Record<string, string>;
}

// ─── Download / Presigned URL Options ────────────────────────────────────────

export interface DownloadOptions {
  bucket?: string;
  /** TTL for presigned URL in seconds */
  expiresIn?: number;
}

// ─── List Options ─────────────────────────────────────────────────────────────

export interface ListOptions {
  bucket?: string;
  /** Key prefix / folder path */
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListResult {
  files: FileMetadata[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}

// ─── Processing ───────────────────────────────────────────────────────────────

export interface ImageProcessingOptions {
  /** Generate thumbnail variant */
  generateThumbnail?: boolean;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  /** Output quality 1-100 */
  quality?: number;
  /** Resize to exact dimensions (distorts aspect ratio) */
  resize?: { width: number; height: number };
  /** Strip EXIF / metadata */
  stripMetadata?: boolean;
  /** Convert to a different format */
  convertTo?: 'jpeg' | 'png' | 'webp' | 'gif';
}

export interface VideoProcessingOptions {
  /** Extract a thumbnail frame */
  generateThumbnail?: boolean;
  /** Second offset for thumbnail extraction */
  thumbnailSecond?: number;
  /** Generate a web-optimised MP4 transcode */
  transcode?: boolean;
  /** Target resolution e.g. "1280x720" */
  resolution?: string;
}

export interface ProcessingResult {
  thumbnailKey?: string;
  thumbnailUrl?: string;
  /** Image/video dimensions */
  width?: number;
  height?: number;
  /** Video duration in seconds */
  duration?: number;
  /** Processing status */
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

// ─── API Response Envelope ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
    version: string;
  };
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    hasMore: boolean;
    nextToken?: string;
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email?: string;
  roles?: string[];
  iat?: number;
  exp?: number;
}
