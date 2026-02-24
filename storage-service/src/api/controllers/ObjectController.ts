import { Request, Response, NextFunction } from 'express';
import { StorageService } from '../../services/storage/StorageService';
import { createLogger } from '../../utils/logger';

const log = createLogger('ObjectController');

/**
 * REST controller for object CRUD operations.
 * Delegates all business logic to StorageService.
 */
export class ObjectController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * POST /objects
   * Upload a file (multipart/form-data, field name: "file").
   */
  upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: { code: 'NO_FILE', message: 'No file uploaded' } });
        return;
      }

      const query = req.query as {
        processImage?: string;
        bucket?: string;
      };

      const result = await this.storageService.upload({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        contentType: req.file.mimetype,
        metadata: { uploadedBy: 'api' },
        bucket: query.bucket,
        processImage: query.processImage === 'true',
      });

      log.info('Upload request handled', { key: result.object.key });

      res.status(201).json({
        data: {
          object: result.object,
          presignedUrl: result.presignedUrl,
          thumbnailPresignedUrl: result.thumbnailPresignedUrl,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /objects/:key/url
   * Generate a fresh presigned URL for an existing object.
   */
  getPresignedUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params.key);
      const { bucket, expiresIn } = req.query as { bucket?: string; expiresIn?: string };

      const url = await this.storageService.getPresignedUrl(
        key,
        bucket,
        expiresIn ? parseInt(expiresIn, 10) : undefined,
      );

      res.json({ data: { url, key } });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /objects/:key/download
   * Stream / download an object's content directly.
   */
  download = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params.key);
      const { bucket } = req.query as { bucket?: string };

      const buffer = await this.storageService.download(key, bucket);

      // Infer content-type from key extension, fallback to octet-stream
      const ext = key.split('.').pop()?.toLowerCase() ?? '';
      const contentTypeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        mp4: 'video/mp4',
        pdf: 'application/pdf',
      };
      const contentType = contentTypeMap[ext] ?? 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop() ?? 'download'}"`);
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  /**
   * DELETE /objects/:key
   */
  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = decodeURIComponent(req.params.key);
      const { bucket } = req.query as { bucket?: string };

      await this.storageService.delete(key, bucket);

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /objects
   * List objects in a bucket under an optional prefix.
   */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { prefix, maxKeys, bucket } = req.query as {
        prefix?: string;
        maxKeys?: string;
        bucket?: string;
      };

      const items = await this.storageService.list(bucket, {
        prefix,
        maxKeys: maxKeys ? parseInt(maxKeys, 10) : undefined,
      });

      res.json({ data: { items, count: items.length } });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /objects/copy
   * Copy an object within or across buckets.
   */
  copy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sourceKey, destKey, sourceBucket, destBucket } = req.body as {
        sourceKey: string;
        destKey: string;
        sourceBucket?: string;
        destBucket?: string;
      };

      await this.storageService.copy(sourceKey, destKey, sourceBucket, destBucket);

      res.status(201).json({ data: { sourceKey, destKey, message: 'Object copied successfully' } });
    } catch (err) {
      next(err);
    }
  };
}
