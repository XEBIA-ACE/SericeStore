import { Response, NextFunction } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { StorageService } from '../../services/storage/StorageService';
import { AppRequest, ApiResponse } from '../../core/types';
import { ValidationError, NotFoundError } from '../../core/errors/AppError';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  prefix: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const presignSchema = z.object({
  expiresIn: z.coerce.number().int().min(60).max(86400).default(3600),
  method: z.enum(['GET', 'PUT']).default('GET'),
});

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * POST /storage/upload
   * Upload a single file.  Expects multipart/form-data with a "file" field.
   */
  async upload(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        throw new ValidationError('No file provided — include a "file" field in the multipart body');
      }

      const file = req.file;
      const prefix = typeof req.body['prefix'] === 'string' ? req.body['prefix'] : undefined;

      // Read the temp file into a buffer, then delete it
      const buffer = fs.readFileSync(file.path);

      try {
        const result = await this.storageService.upload(
          file.originalname,
          buffer,
          file.mimetype,
          req.body['metadata'] ? JSON.parse(String(req.body['metadata'])) as Record<string, string> : undefined,
          prefix,
        );

        res.status(201).json({
          success: true,
          data: result,
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        } satisfies ApiResponse);
      } finally {
        // Always clean up the temp file
        fs.unlinkSync(file.path);
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /storage/:key(*)
   * Download a file.  Streams the object body directly to the response.
   */
  async download(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.params['key'];
      if (!key) throw new ValidationError('Missing key parameter');

      const { stream, metadata } = await this.storageService.download(key);

      res.setHeader('Content-Type', metadata.contentType);
      res.setHeader('Content-Length', metadata.size);
      res.setHeader('ETag', metadata.etag ?? '');
      res.setHeader('X-Storage-Key', key);

      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /storage/:key(*)/metadata
   * Return object metadata without downloading the body.
   */
  async getMetadata(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.params['key'];
      if (!key) throw new ValidationError('Missing key parameter');

      const metadata = await this.storageService.getMetadata(key);

      res.status(200).json({
        success: true,
        data: metadata,
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /storage/:key(*)
   * Delete an object from storage.
   */
  async delete(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.params['key'];
      if (!key) throw new ValidationError('Missing key parameter');

      const exists = await this.storageService.exists(key);
      if (!exists) throw new NotFoundError(`Object "${key}" not found`);

      await this.storageService.delete(key);

      res.status(200).json({
        success: true,
        data: { key, deleted: true },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /storage/:key(*)/copy
   * Copy an object within the bucket.  Optionally supply a destination key
   * in the request body; if omitted, a new key is generated.
   */
  async copy(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const sourceKey = req.params['key'];
      if (!sourceKey) throw new ValidationError('Missing key parameter');

      const destinationKey =
        typeof req.body['destinationKey'] === 'string' ? req.body['destinationKey'] : undefined;

      const result = await this.storageService.copy(sourceKey, destinationKey);

      res.status(201).json({
        success: true,
        data: result,
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /storage/:key(*)/presign
   * Generate a pre-signed URL for the given key.
   */
  async presign(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.params['key'];
      if (!key) throw new ValidationError('Missing key parameter');

      const opts = presignSchema.safeParse(req.query);
      if (!opts.success) throw new ValidationError('Invalid query parameters', opts.error.flatten());

      const url = await this.storageService.getPresignedUrl(key, opts.data);

      res.status(200).json({
        success: true,
        data: { key, url, expiresIn: opts.data.expiresIn },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /storage
   * List objects with optional prefix filtering and cursor-based pagination.
   */
  async list(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Invalid query parameters', parsed.error.flatten());

      const { prefix, cursor, limit } = parsed.data;
      const result = await this.storageService.list(prefix, cursor, limit);

      res.status(200).json({
        success: true,
        data: result,
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  }
}
