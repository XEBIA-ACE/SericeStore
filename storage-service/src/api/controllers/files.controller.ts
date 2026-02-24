/**
 * FilesController — thin adapter between HTTP and FileService.
 *
 * Each handler:
 *  1. Parses / validates the request
 *  2. Delegates to FileService
 *  3. Formats the ApiResponse envelope
 *  4. Passes errors to next() for the error middleware
 */

import { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { FileService } from '../../services/file.service';
import { ApiResponse, FileMetadata, ListResult, PaginatedResponse } from '../../core/types';
import { appConfig } from '../../config';
import {
  validate,
  listQuerySchema,
  presignedUrlQuerySchema,
  deleteBodySchema,
  uploadQuerySchema,
} from '../../utils/validators';
import { ValidationError } from '../../utils/errors';

export class FilesController {
  constructor(private readonly fileService: FileService) {}

  // ─── Upload Single ─────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files:
   *   post:
   *     summary: Upload a single file
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *               processMedia:
   *                 type: boolean
   *               tags:
   *                 type: string
   *                 description: JSON-encoded key-value tags
   *     responses:
   *       201:
   *         description: File uploaded successfully
   *       400:
   *         description: Validation error
   *       413:
   *         description: File too large
   *       415:
   *         description: Unsupported media type
   */
  upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        throw new ValidationError('No file provided. Include a "file" field in multipart/form-data.');
      }

      const { value: query, error: queryErr } = validate(uploadQuerySchema, req.query);
      if (queryErr) throw new ValidationError(queryErr);

      let parsedTags: Record<string, string> | undefined;
      if (req.body.tags) {
        try {
          parsedTags = JSON.parse(String(req.body.tags)) as Record<string, string>;
        } catch {
          throw new ValidationError('tags must be a valid JSON object');
        }
      }

      const stream = Readable.from(req.file.buffer);

      const metadata = await this.fileService.uploadFile(
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        stream,
        {
          processMedia: query.processMedia,
          uploadedBy: req.user?.sub ?? query.uploadedBy,
          tags: parsedTags,
        },
      );

      const response: ApiResponse<FileMetadata> = {
        success: true,
        data: metadata,
        meta: this.buildMeta(req),
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ─── Download ──────────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files/{key}:
   *   get:
   *     summary: Download a file
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: File stream
   *       404:
   *         description: File not found
   */
  download = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params['key'] ?? '');
      const stream = await this.fileService.downloadFile(key);

      res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop() ?? key}"`);
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  };

  // ─── Presigned URL ─────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files/{key}/url:
   *   get:
   *     summary: Generate a presigned download URL
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: expiresIn
   *         schema:
   *           type: integer
   *           default: 3600
   *     responses:
   *       200:
   *         description: Presigned URL
   *       404:
   *         description: File not found
   */
  getPresignedUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params['key'] ?? '');
      const { value: query, error } = validate(presignedUrlQuerySchema, req.query);
      if (error) throw new ValidationError(error);

      const url = await this.fileService.getPresignedUrl(key, { expiresIn: query.expiresIn, bucket: query.bucket });

      const response: ApiResponse<{ url: string; expiresIn: number }> = {
        success: true,
        data: { url, expiresIn: query.expiresIn },
        meta: this.buildMeta(req),
      };
      res.json(response);
    } catch (err) {
      next(err);
    }
  };

  // ─── Get Metadata ──────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files/{key}/metadata:
   *   get:
   *     summary: Retrieve file metadata without downloading the content
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   */
  getMetadata = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params['key'] ?? '');
      const metadata = await this.fileService.getFileMetadata(key);
      const response: ApiResponse<Partial<FileMetadata>> = {
        success: true,
        data: metadata,
        meta: this.buildMeta(req),
      };
      res.json(response);
    } catch (err) {
      next(err);
    }
  };

  // ─── List ──────────────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files:
   *   get:
   *     summary: List files (optionally by prefix)
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: prefix
   *         schema:
   *           type: string
   *       - in: query
   *         name: maxKeys
   *         schema:
   *           type: integer
   *           default: 100
   *       - in: query
   *         name: continuationToken
   *         schema:
   *           type: string
   */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { value: query, error } = validate(listQuerySchema, req.query);
      if (error) throw new ValidationError(error);

      const result: ListResult = await this.fileService.listFiles({
        prefix: query.prefix,
        maxKeys: query.maxKeys,
        continuationToken: query.continuationToken,
        bucket: query.bucket,
      });

      const response: PaginatedResponse<FileMetadata> = {
        success: true,
        data: result.files,
        pagination: {
          hasMore: result.isTruncated,
          nextToken: result.nextContinuationToken,
        },
        meta: this.buildMeta(req),
      };
      res.json(response);
    } catch (err) {
      next(err);
    }
  };

  // ─── Delete ────────────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files/{key}:
   *   delete:
   *     summary: Delete a single file
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   */
  deleteOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params['key'] ?? '');
      await this.fileService.deleteFile(key);
      const response: ApiResponse = {
        success: true,
        data: { deleted: key },
        meta: this.buildMeta(req),
      };
      res.json(response);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @swagger
   * /api/v1/files:
   *   delete:
   *     summary: Batch-delete multiple files
   *     tags: [Files]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               keys:
   *                 type: array
   *                 items:
   *                   type: string
   */
  deleteMany = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { value: body, error } = validate(deleteBodySchema, req.body);
      if (error) throw new ValidationError(error);

      await this.fileService.deleteFiles(body.keys as string[], (body as { bucket?: string }).bucket);
      const response: ApiResponse = {
        success: true,
        data: { deleted: (body as { keys: string[] }).keys.length },
        meta: this.buildMeta(req),
      };
      res.json(response);
    } catch (err) {
      next(err);
    }
  };

  // ─── Copy ──────────────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/v1/files/{key}/copy:
   *   post:
   *     summary: Copy a file to a new key
   *     tags: [Files]
   */
  copy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sourceKey = decodeURIComponent(req.params['key'] ?? '');
      const { destinationKey, sourceBucket, destinationBucket } = req.body as {
        destinationKey?: string;
        sourceBucket?: string;
        destinationBucket?: string;
      };

      if (!destinationKey) throw new ValidationError('destinationKey is required');

      await this.fileService.copyFile(sourceKey, destinationKey, sourceBucket, destinationBucket);

      const response: ApiResponse = {
        success: true,
        data: { source: sourceKey, destination: destinationKey },
        meta: this.buildMeta(req),
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  // ─── Helper ────────────────────────────────────────────────────────────────

  private buildMeta(req: Request): ApiResponse['meta'] {
    return {
      requestId: (req.headers['x-request-id'] as string | undefined) ?? 'unknown',
      timestamp: new Date().toISOString(),
      version: appConfig.version,
    };
  }
}
