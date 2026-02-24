import { Router, RequestHandler } from 'express';
import { MediaController } from '../controllers/MediaController';
import { authMiddleware } from '../middleware/auth.middleware';
import { AppRequest } from '../../core/types';

export function createMediaRouter(controller: MediaController): Router {
  const router = Router();

  router.use(authMiddleware as RequestHandler);

  // ── Image ──────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /media/image/transform:
   *   post:
   *     summary: Transform an image (resize, convert, rotate, etc.)
   *     tags: [Media]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [sourceKey]
   *             properties:
   *               sourceKey: { type: string }
   *               width: { type: integer }
   *               height: { type: integer }
   *               fit: { type: string, enum: [cover, contain, fill, inside, outside] }
   *               format: { type: string, enum: [jpeg, png, webp, gif, tiff] }
   *               quality: { type: integer, minimum: 1, maximum: 100 }
   *               rotate: { type: integer }
   *               flipX: { type: boolean }
   *               flipY: { type: boolean }
   *               greyscale: { type: boolean }
   *               outputPrefix: { type: string }
   *     responses:
   *       200:
   *         description: Transformed image uploaded and URL returned
   */
  router.post('/image/transform', (req, res, next) =>
    controller.transformImage(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /media/image/metadata:
   *   get:
   *     summary: Get image metadata (dimensions, format, colorspace)
   *     tags: [Media]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: query
   *         name: key
   *         required: true
   *         schema: { type: string }
   */
  router.get('/image/metadata', (req, res, next) =>
    controller.imageMetadata(req as AppRequest, res, next),
  );

  // ── Video ──────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /media/video/transcode:
   *   post:
   *     summary: Transcode a video or audio file
   *     tags: [Media]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [sourceKey]
   *             properties:
   *               sourceKey: { type: string }
   *               format: { type: string }
   *               videoCodec: { type: string }
   *               audioCodec: { type: string }
   *               videoBitrate: { type: string }
   *               audioBitrate: { type: string }
   *               fps: { type: integer }
   *               width: { type: integer }
   *               height: { type: integer }
   *               outputPrefix: { type: string }
   */
  router.post('/video/transcode', (req, res, next) =>
    controller.transcodeVideo(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /media/video/thumbnail:
   *   post:
   *     summary: Extract a thumbnail from a video
   *     tags: [Media]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [sourceKey]
   *             properties:
   *               sourceKey: { type: string }
   *               timestamp: { type: number }
   *               width: { type: integer }
   *               format: { type: string, enum: [jpeg, png] }
   *               outputPrefix: { type: string }
   */
  router.post('/video/thumbnail', (req, res, next) =>
    controller.extractThumbnail(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /media/video/metadata:
   *   get:
   *     summary: Get video/audio metadata (duration, codec, bitrate)
   *     tags: [Media]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: query
   *         name: key
   *         required: true
   *         schema: { type: string }
   */
  router.get('/video/metadata', (req, res, next) =>
    controller.videoMetadata(req as AppRequest, res, next),
  );

  return router;
}
