import { Router } from 'express';
import { ObjectController } from '../controllers/ObjectController';
import { authenticate } from '../middlewares/auth';
import { uploadMiddleware } from '../middlewares/upload';
import {
  validateUploadQuery,
  validateObjectKeyParam,
  validateListQuery,
  validatePresignedUrlQuery,
  validateCopyBody,
} from '../validators/objectValidators';

/**
 * Mount object CRUD routes.
 *
 * @openapi
 * tags:
 *   - name: Objects
 *     description: Cloud object storage operations
 */
export function objectRoutes(controller: ObjectController): Router {
  const router = Router();

  /**
   * @openapi
   * /objects:
   *   post:
   *     summary: Upload a file
   *     tags: [Objects]
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
   *     parameters:
   *       - in: query
   *         name: processImage
   *         schema:
   *           type: boolean
   *         description: Resize and generate thumbnail for images
   *       - in: query
   *         name: bucket
   *         schema:
   *           type: string
   *         description: Override the default bucket
   *     responses:
   *       201:
   *         description: File uploaded successfully
   *       400:
   *         description: Bad request
   *       413:
   *         description: File too large
   *       415:
   *         description: Unsupported media type
   */
  router.post(
    '/',
    authenticate,
    validateUploadQuery,
    uploadMiddleware.single('file'),
    controller.upload,
  );

  /**
   * @openapi
   * /objects:
   *   get:
   *     summary: List objects
   *     tags: [Objects]
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
   *         name: bucket
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: List of objects
   */
  router.get('/', authenticate, validateListQuery, controller.list);

  /**
   * @openapi
   * /objects/copy:
   *   post:
   *     summary: Copy an object
   *     tags: [Objects]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [sourceKey, destKey]
   *             properties:
   *               sourceKey:
   *                 type: string
   *               destKey:
   *                 type: string
   *               sourceBucket:
   *                 type: string
   *               destBucket:
   *                 type: string
   *     responses:
   *       201:
   *         description: Object copied
   */
  router.post('/copy', authenticate, validateCopyBody, controller.copy);

  /**
   * @openapi
   * /objects/{key}/url:
   *   get:
   *     summary: Get a presigned download URL
   *     tags: [Objects]
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
   *       - in: query
   *         name: bucket
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Presigned URL
   *       404:
   *         description: Object not found
   */
  router.get(
    '/:key/url',
    authenticate,
    validatePresignedUrlQuery,
    controller.getPresignedUrl,
  );

  /**
   * @openapi
   * /objects/{key}/download:
   *   get:
   *     summary: Download an object directly
   *     tags: [Objects]
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
   *         description: File content
   *       404:
   *         description: Object not found
   */
  router.get('/:key/download', authenticate, controller.download);

  /**
   * @openapi
   * /objects/{key}:
   *   delete:
   *     summary: Delete an object
   *     tags: [Objects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: Object deleted
   *       404:
   *         description: Object not found
   */
  router.delete('/:key', authenticate, validateObjectKeyParam, controller.delete);

  return router;
}
