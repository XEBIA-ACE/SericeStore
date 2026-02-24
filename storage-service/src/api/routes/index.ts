/**
 * Root router — wires all sub-routers together and mounts them.
 *
 * Route tree:
 *   /health/*       → health.routes
 *   /metrics        → Prometheus metrics
 *   /api/v1/files/* → files.routes
 *   /api/docs       → Swagger UI
 */

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../swagger';
import { createFilesRouter } from './files.routes';
import { createHealthRouter } from './health.routes';
import { FilesController } from '../controllers/files.controller';
import { HealthController } from '../controllers/health.controller';
import { FileService } from '../../services/file.service';
import { getStorageProvider } from '../../services/storage/storage.factory';
import { ImageProcessor } from '../../services/processing/image.processor';
import { VideoProcessor } from '../../services/processing/video.processor';

export function createRootRouter(): Router {
  const router = Router();

  // ── Dependency wiring (poor-man's DI container) ──────────────────────────
  const storageProvider = getStorageProvider();
  const imageProcessor = new ImageProcessor();
  const videoProcessor = new VideoProcessor();
  const fileService = new FileService(storageProvider, imageProcessor, videoProcessor);

  const filesController = new FilesController(fileService);
  const healthController = new HealthController(fileService);

  // ── Mount routes ─────────────────────────────────────────────────────────
  router.use('/health', createHealthRouter(healthController));
  router.get('/metrics', healthController.metrics);
  router.use('/api/v1/files', createFilesRouter(filesController));
  router.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  return router;
}
