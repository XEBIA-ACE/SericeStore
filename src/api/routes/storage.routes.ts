import { Router, RequestHandler } from 'express';
import { StorageController } from '../controllers/StorageController';
import { authMiddleware } from '../middleware/auth.middleware';
import { singleUpload, handleMulterError } from '../middleware/upload.middleware';
import { AppRequest } from '../../core/types';

export function createStorageRouter(controller: StorageController): Router {
  const router = Router();

  // All storage routes require authentication
  router.use(authMiddleware as RequestHandler);

  /**
   * @openapi
   * /storage:
   *   get:
   *     summary: List objects
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: query
   *         name: prefix
   *         schema: { type: string }
   *       - in: query
   *         name: cursor
   *         schema: { type: string }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 100 }
   *     responses:
   *       200:
   *         description: Paginated list of objects
   */
  router.get('/', (req, res, next) =>
    controller.list(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /storage/upload:
   *   post:
   *     summary: Upload a file
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
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
   *               prefix:
   *                 type: string
   *               metadata:
   *                 type: string
   *                 description: JSON-encoded key-value metadata
   *     responses:
   *       201:
   *         description: File uploaded successfully
   */
  router.post(
    '/upload',
    singleUpload as RequestHandler,
    handleMulterError as unknown as RequestHandler,
    (req, res, next) => controller.upload(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /storage/{key}/metadata:
   *   get:
   *     summary: Get object metadata
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema: { type: string }
   */
  router.get('/:key(*)/metadata', (req, res, next) =>
    controller.getMetadata(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /storage/{key}/presign:
   *   get:
   *     summary: Generate a pre-signed URL
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: expiresIn
   *         schema: { type: integer, default: 3600 }
   *       - in: query
   *         name: method
   *         schema: { type: string, enum: [GET, PUT] }
   */
  router.get('/:key(*)/presign', (req, res, next) =>
    controller.presign(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /storage/{key}/copy:
   *   post:
   *     summary: Copy an object
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
   */
  router.post('/:key(*)/copy', (req, res, next) =>
    controller.copy(req as AppRequest, res, next),
  );

  /**
   * @openapi
   * /storage/{key}:
   *   get:
   *     summary: Download a file
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
   *   delete:
   *     summary: Delete a file
   *     tags: [Storage]
   *     security:
   *       - BearerAuth: []
   */
  router.get('/:key(*)', (req, res, next) =>
    controller.download(req as AppRequest, res, next),
  );

  router.delete('/:key(*)', (req, res, next) =>
    controller.delete(req as AppRequest, res, next),
  );

  return router;
}
