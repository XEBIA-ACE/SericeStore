import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import mime from 'mime-types';

/**
 * Generate a unique storage key for an uploaded file.
 *
 * Format: <prefix>/<year>/<month>/<uuid>.<ext>
 *
 * @param originalName  Original filename from the client
 * @param prefix        Logical folder prefix (e.g. 'images', 'videos', 'documents')
 */
export function generateStorageKey(originalName: string, prefix: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = uuidv4();
  return `${prefix}/${year}/${month}/${id}${ext}`;
}

/**
 * Derive the logical prefix from a MIME type.
 */
export function prefixFromMime(contentType: string): string {
  if (contentType.startsWith('image/')) return 'images';
  if (contentType.startsWith('video/')) return 'videos';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'documents';
}

/**
 * Build a thumbnail key from an existing object key.
 */
export function thumbnailKey(objectKey: string): string {
  const dir = path.dirname(objectKey);
  const base = path.basename(objectKey, path.extname(objectKey));
  return `${dir}/thumbnails/${base}_thumb.jpg`;
}

/**
 * Lookup MIME type from a filename extension.
 */
export function mimeFromFilename(filename: string): string {
  return mime.lookup(filename) || 'application/octet-stream';
}
