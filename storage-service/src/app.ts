import 'express-async-errors';
import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { requestLogger } from './api/middlewares/requestLogger';
import { errorHandler, notFoundHandler } from './api/middlewares/errorHandler';
import { objectRoutes } from './api/routes/objectRoutes';
import { healthRoutes } from './api/routes/healthRoutes';
import { ObjectController } from './api/controllers/ObjectController';
import { HealthController } from './api/controllers/HealthController';
import { MetricsController } from './api/controllers/MetricsController';
import { StorageService } from './services/storage/StorageService';
import { HealthService } from './services/health/HealthService';
import { ImageProcessor } from './services/media/ImageProcessor';
import { StorageProviderFactory } from './providers/StorageProviderFactory';

/**
 * Build and wire up the Express application.
 *
 * This is the composition root: all dependencies are instantiated here
 * and injected into their consumers.
 */
export function createApp(): Application {
  const app = express();

  // ── Security & utility middleware ─────────────────────────────────────────
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Rate limiting ─────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Request logging ───────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Dependency injection / composition ───────────────────────────────────
  const storageProvider = StorageProviderFactory.create(config.storage.provider);
  const imageProcessor = new ImageProcessor();

  const storageService = new StorageService(storageProvider, imageProcessor);
  const healthService = new HealthService(storageProvider);

  const objectController = new ObjectController(storageService);
  const healthController = new HealthController(healthService);
  const metricsController = new MetricsController();

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/v1/objects', objectRoutes(objectController));
  app.use('/health', healthRoutes(healthController, metricsController));

  // ── 404 & error handling (must be last) ──────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
