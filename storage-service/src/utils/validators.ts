/**
 * Input-validation helpers.
 * Uses Joi for schema validation; centralised here so rules stay DRY.
 */

import Joi from 'joi';
import { storageConfig } from '../config';
import { FileCategory } from '../core/types';

// ─── MIME Type Helpers ────────────────────────────────────────────────────────

export function resolveFileCategory(mimeType: string): FileCategory {
  if (storageConfig.allowedImageTypes.includes(mimeType)) return 'image';
  if (storageConfig.allowedVideoTypes.includes(mimeType)) return 'video';
  if (storageConfig.allowedDocumentTypes.includes(mimeType)) return 'document';
  return 'other';
}

export function isAllowedMimeType(mimeType: string): boolean {
  return [
    ...storageConfig.allowedImageTypes,
    ...storageConfig.allowedVideoTypes,
    ...storageConfig.allowedDocumentTypes,
  ].includes(mimeType);
}

// ─── Object Key Sanitisation ──────────────────────────────────────────────────

/**
 * Sanitise an object key: strip leading slashes, collapse dots, remove traversal sequences.
 */
export function sanitiseKey(raw: string): string {
  return raw
    .replace(/\.\.\//g, '') // no path traversal
    .replace(/^\/+/, '')    // no leading slash
    .replace(/[^\w.\-/]/g, '_'); // restrict charset
}

// ─── Joi Schemas ──────────────────────────────────────────────────────────────

export const uploadQuerySchema = Joi.object({
  processMedia: Joi.boolean().default(true),
  prefix: Joi.string().max(512).optional(),
  uploadedBy: Joi.string().max(256).optional(),
  tags: Joi.string().max(1024).optional(), // JSON-encoded key-value map
});

export const listQuerySchema = Joi.object({
  prefix: Joi.string().max(512).optional().allow(''),
  maxKeys: Joi.number().integer().min(1).max(1000).default(100),
  continuationToken: Joi.string().max(2048).optional(),
  bucket: Joi.string().max(63).optional(),
});

export const presignedUrlQuerySchema = Joi.object({
  expiresIn: Joi.number().integer().min(60).max(604_800).default(3600),
  bucket: Joi.string().max(63).optional(),
});

export const deleteBodySchema = Joi.object({
  keys: Joi.array().items(Joi.string().max(1024)).min(1).max(100).required(),
  bucket: Joi.string().max(63).optional(),
});

// ─── Generic Validate Helper ──────────────────────────────────────────────────

export function validate<T>(
  schema: Joi.ObjectSchema<T>,
  data: unknown,
): { value: T; error?: string } {
  const result = schema.validate(data, { abortEarly: false, stripUnknown: true });
  if (result.error) {
    return {
      value: result.value as T,
      error: result.error.details.map((d) => d.message).join('; '),
    };
  }
  return { value: result.value as T };
}
