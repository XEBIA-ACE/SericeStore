/**
 * File-management routes.
 *
 * Base path: /api/v1/files  (mounted in src/api/routes/index.ts)
 */

import { Router } from 'express';
import { FilesController } from '../controllers/files.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { uploadSingle } from '../middleware/upload.middleware';

export function createFilesRouter(controller: FilesController): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);

  /**
   * POST /api/v1/files
   * Upload a single file (multipart/form-data).
   */
  router.post('/', uploadSingle, controller.upload);

  /**
   * GET /api/v1/files
   * List stored files (paginated, supports ?prefix=, ?maxKeys=, ?continuationToken=).
   */
  router.get('/', controller.list);

  /**
   * DELETE /api/v1/files
   * Batch-delete multiple files by key array in request body.
   */
  router.delete('/', controller.deleteMany);

  /**
   * GET /api/v1/files/:key
   * Stream-download a file. :key may contain slashes (URL-encoded).
   */
  router.get('/:key(*)', controller.download);

  /**
   * GET /api/v1/files/:key/url
   * Generate a time-limited presigned URL.
   */
  router.get('/:key(*)/url', controller.getPresignedUrl);

  /**
   * GET /api/v1/files/:key/metadata
   * Retrieve object metadata without streaming the body.
   */
  router.get('/:key(*)/metadata', controller.getMetadata);

  /**
   * POST /api/v1/files/:key/copy
   * Copy a file to a new key / bucket.
   */
  router.post('/:key(*)/copy', controller.copy);

  /**
   * DELETE /api/v1/files/:key
   * Delete a single file.
   */
  router.delete('/:key(*)', controller.deleteOne);

  return router;
}
