import { Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { StorageService } from '../../services/storage/StorageService';
import { ImageProcessingService } from '../../services/media/ImageProcessingService';
import { VideoProcessingService } from '../../services/media/VideoProcessingService';
import { AppRequest, ApiResponse } from '../../core/types';
import { ValidationError, NotFoundError } from '../../core/errors/AppError';
import {
  mediaProcessingTotal,
  mediaProcessingDurationMs,
} from '../../utils/metrics';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const imageTransformSchema = z.object({
  sourceKey: z.string().min(1),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).optional(),
  format: z.enum(['jpeg', 'png', 'webp', 'gif', 'tiff']).optional(),
  quality: z.coerce.number().int().min(1).max(100).optional(),
  rotate: z.coerce.number().int().optional(),
  flipX: z.coerce.boolean().optional(),
  flipY: z.coerce.boolean().optional(),
  greyscale: z.coerce.boolean().optional(),
  /** Optional output key prefix (e.g. 'thumbnails') */
  outputPrefix: z.string().optional(),
});

const videoTranscodeSchema = z.object({
  sourceKey: z.string().min(1),
  format: z.string().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  videoBitrate: z.string().optional(),
  audioBitrate: z.string().optional(),
  fps: z.coerce.number().int().positive().optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  outputPrefix: z.string().optional(),
});

const thumbnailSchema = z.object({
  sourceKey: z.string().min(1),
  timestamp: z.coerce.number().min(0).optional(),
  width: z.coerce.number().int().positive().optional(),
  format: z.enum(['jpeg', 'png']).optional(),
  outputPrefix: z.string().optional(),
});

const metaQuerySchema = z.object({
  key: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class MediaController {
  constructor(
    private readonly storageService: StorageService,
    private readonly imageProcessor: ImageProcessingService,
    private readonly videoProcessor: VideoProcessingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Image endpoints
  // ---------------------------------------------------------------------------

  /**
   * POST /media/image/transform
   * Download an image from storage, apply transformations, and upload the result.
   */
  async transformImage(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    const timer = mediaProcessingDurationMs.startTimer({ type: 'image_transform' });
    try {
      const body = imageTransformSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError('Invalid request body', body.error.flatten());

      const { sourceKey, outputPrefix, ...options } = body.data;
      const exists = await this.storageService.exists(sourceKey);
      if (!exists) throw new NotFoundError(`Source object "${sourceKey}" not found`);

      // Determine output extension
      const outputExt = options.format ? `.${options.format}` : path.extname(sourceKey) || '.jpg';
      const inputTmp = ImageProcessingService.tempPath(path.extname(sourceKey) || '.img');
      const outputTmp = ImageProcessingService.tempPath(outputExt);

      try {
        // Download source to temp file
        await this.downloadToFile(sourceKey, inputTmp);

        // Transform
        await this.imageProcessor.transform(inputTmp, outputTmp, options);

        // Upload result
        const outputBuffer = fs.readFileSync(outputTmp);
        const contentType = this.extToMime(outputExt);

        const result = await this.storageService.upload(
          `transformed${outputExt}`,
          outputBuffer,
          contentType,
          { sourceKey },
          outputPrefix ?? 'processed/images',
        );

        mediaProcessingTotal.inc({ type: 'image_transform', status: 'success' });

        res.status(200).json({
          success: true,
          data: result,
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        } satisfies ApiResponse);
      } finally {
        this.safeUnlink(inputTmp);
        this.safeUnlink(outputTmp);
        timer();
      }
    } catch (err) {
      mediaProcessingTotal.inc({ type: 'image_transform', status: 'error' });
      timer();
      next(err);
    }
  }

  /**
   * GET /media/image/metadata?key=<key>
   * Return image metadata without downloading the full object.
   */
  async imageMetadata(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = metaQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Missing required query param: key');

      const { key } = parsed.data;
      const exists = await this.storageService.exists(key);
      if (!exists) throw new NotFoundError(`Object "${key}" not found`);

      const tmpPath = ImageProcessingService.tempPath(path.extname(key));
      try {
        await this.downloadToFile(key, tmpPath);
        const metadata = await this.imageProcessor.getMetadata(tmpPath);

        res.status(200).json({
          success: true,
          data: metadata,
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        } satisfies ApiResponse);
      } finally {
        this.safeUnlink(tmpPath);
      }
    } catch (err) {
      next(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Video endpoints
  // ---------------------------------------------------------------------------

  /**
   * POST /media/video/transcode
   * Transcode a video file and upload the result.
   */
  async transcodeVideo(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    const timer = mediaProcessingDurationMs.startTimer({ type: 'video_transcode' });
    try {
      const body = videoTranscodeSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError('Invalid request body', body.error.flatten());

      const { sourceKey, outputPrefix, ...options } = body.data;
      const exists = await this.storageService.exists(sourceKey);
      if (!exists) throw new NotFoundError(`Source object "${sourceKey}" not found`);

      const outputExt = options.format ? `.${options.format}` : '.mp4';
      const inputTmp = VideoProcessingService.tempPath(path.extname(sourceKey) || '.mp4');
      const outputTmp = VideoProcessingService.tempPath(outputExt);

      try {
        await this.downloadToFile(sourceKey, inputTmp);
        await this.videoProcessor.transcode(inputTmp, outputTmp, options);

        const outputBuffer = fs.readFileSync(outputTmp);
        const contentType = this.extToMime(outputExt);

        const result = await this.storageService.upload(
          `transcoded${outputExt}`,
          outputBuffer,
          contentType,
          { sourceKey },
          outputPrefix ?? 'processed/videos',
        );

        mediaProcessingTotal.inc({ type: 'video_transcode', status: 'success' });

        res.status(200).json({
          success: true,
          data: result,
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        } satisfies ApiResponse);
      } finally {
        this.safeUnlink(inputTmp);
        this.safeUnlink(outputTmp);
        timer();
      }
    } catch (err) {
      mediaProcessingTotal.inc({ type: 'video_transcode', status: 'error' });
      timer();
      next(err);
    }
  }

  /**
   * POST /media/video/thumbnail
   * Extract a thumbnail frame from a video.
   */
  async extractThumbnail(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    const timer = mediaProcessingDurationMs.startTimer({ type: 'thumbnail' });
    try {
      const body = thumbnailSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError('Invalid request body', body.error.flatten());

      const { sourceKey, outputPrefix, ...options } = body.data;
      const exists = await this.storageService.exists(sourceKey);
      if (!exists) throw new NotFoundError(`Source object "${sourceKey}" not found`);

      const outputExt = `.${options.format ?? 'jpeg'}`;
      const inputTmp = VideoProcessingService.tempPath(path.extname(sourceKey) || '.mp4');
      const outputTmp = VideoProcessingService.tempPath(outputExt);

      try {
        await this.downloadToFile(sourceKey, inputTmp);
        await this.videoProcessor.extractThumbnail(inputTmp, outputTmp, options);

        const outputBuffer = fs.readFileSync(outputTmp);
        const contentType = this.extToMime(outputExt);

        const result = await this.storageService.upload(
          `thumbnail${outputExt}`,
          outputBuffer,
          contentType,
          { sourceKey },
          outputPrefix ?? 'processed/thumbnails',
        );

        mediaProcessingTotal.inc({ type: 'thumbnail', status: 'success' });

        res.status(200).json({
          success: true,
          data: result,
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        } satisfies ApiResponse);
      } finally {
        this.safeUnlink(inputTmp);
        this.safeUnlink(outputTmp);
        timer();
      }
    } catch (err) {
      mediaProcessingTotal.inc({ type: 'thumbnail', status: 'error' });
      timer();
      next(err);
    }
  }

  /**
   * GET /media/video/metadata?key=<key>
   * Return video/audio metadata via FFprobe.
   */
  async videoMetadata(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = metaQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Missing required query param: key');

      const { key } = parsed.data;
      const exists = await this.storageService.exists(key);
      if (!exists) throw new NotFoundError(`Object "${key}" not found`);

      const tmpPath = VideoProcessingService.tempPath(path.extname(key));
      try {
        await this.downloadToFile(key, tmpPath);
        const metadata = await this.videoProcessor.getMetadata(tmpPath);

        res.status(200).json({
          success: true,
          data: metadata,
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        } satisfies ApiResponse);
      } finally {
        this.safeUnlink(tmpPath);
      }
    } catch (err) {
      next(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Download a storage object and write it to a local temp file.
   */
  private async downloadToFile(key: string, filePath: string): Promise<void> {
    const { stream } = await this.storageService.download(key);
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      stream.on('error', reject);
    });
  }

  private safeUnlink(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn('Failed to clean up temp file', { filePath, error: String(err) });
    }
  }

  private extToMime(ext: string): string {
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.tiff': 'image/tiff',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
    };
    return map[ext.toLowerCase()] ?? 'application/octet-stream';
  }
}
