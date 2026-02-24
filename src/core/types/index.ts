import { Request } from 'express';

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------
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
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Express extension – adds requestId to every request
// ---------------------------------------------------------------------------
export interface AppRequest extends Request {
  requestId: string;
  /** Set by auth middleware when the token is validated */
  user?: {
    id: string;
    roles: string[];
  };
}

// ---------------------------------------------------------------------------
// Supported storage providers
// ---------------------------------------------------------------------------
export type StorageProviderName = 's3' | 'gcs' | 'minio';

// ---------------------------------------------------------------------------
// Upload result returned to the caller after a file is persisted
// ---------------------------------------------------------------------------
export interface UploadResult {
  /** Storage key (the path inside the bucket) */
  key: string;
  /** Original filename as provided by the client */
  originalName: string;
  /** MIME type */
  contentType: string;
  /** File size in bytes */
  size: number;
  /** ETag / version */
  etag?: string;
  /** Pre-signed download URL (short-lived) */
  url?: string;
}

// ---------------------------------------------------------------------------
// Media processing job result
// ---------------------------------------------------------------------------
export interface ProcessingResult {
  /** Storage key of the output artifact */
  key: string;
  contentType: string;
  size: number;
  /** Pre-signed URL for the processed artifact */
  url?: string;
}
