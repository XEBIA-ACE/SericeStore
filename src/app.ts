import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { requestIdMiddleware } from './api/middleware/requestId.middleware';
import { requestLogger } from './api/middleware/logger.middleware';
import { notFoundHandler, globalErrorHandler } from './api/middleware/error.middleware';
import { HealthController } from './api/controllers/HealthController';
import { StorageController } from './api/controllers/StorageController';
import { MediaController } from './api/controllers/MediaController';
import { StorageService } from './services/storage/StorageService';
import { ImageProcessingService } from './services/media/ImageProcessingService';
import { VideoProcessingService } from './services/media/VideoProcessingService';
import { createStorageProvider } from './services/storage/StorageProviderFactory';
import { createRouter } from './api/routes';
import { register } from './utils/metrics';

export function createApp(): Express {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

  // ── Rate limiting ───────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Request parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Observability ───────────────────────────────────────────────────────────
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  // Prometheus metrics endpoint (no auth — typically protected at network level)
  if (config.METRICS_ENDPOINT) {
    app.get(config.METRICS_ENDPOINT, async (_req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });
  }

  // ── Dependency wiring (manual DI) ───────────────────────────────────────────
  const storageProvider = createStorageProvider(config);
  const storageService = new StorageService(storageProvider);
  const imageProcessor = new ImageProcessingService();
  const videoProcessor = new VideoProcessingService();

  const healthController = new HealthController();
  const storageController = new StorageController(storageService);
  const mediaController = new MediaController(storageService, imageProcessor, videoProcessor);

  // ── Routes ──────────────────────────────────────────────────────────────────
  const router = createRouter(healthController, storageController, mediaController);
  app.use(config.API_PREFIX, router);

  // ── Error handling ──────────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

export type { StorageService, ImageProcessingService, VideoProcessingService };
