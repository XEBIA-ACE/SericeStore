/**
 * Express application factory.
 *
 * Separated from src/index.ts so the app can be imported in tests
 * without starting the HTTP server.
 */

import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { appConfig, corsConfig, rateLimitConfig } from './config';
import { requestIdMiddleware } from './api/middleware/request-id.middleware';
import { errorMiddleware, notFoundMiddleware } from './api/middleware/error.middleware';
import { createRootRouter } from './api/routes';
import logger from './utils/logger';

export function createApp(): Application {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: corsConfig.origins,
      methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      credentials: true,
    }),
  );

  // ── Request decompression ────────────────────────────────────────────────
  app.use(compression());

  // ── Body parsers (JSON and URL-encoded; multipart handled by multer) ─────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Request ID ──────────────────────────────────────────────────────────
  app.use(requestIdMiddleware);

  // ── HTTP request logging ─────────────────────────────────────────────────
  app.use(
    morgan(appConfig.isDev ? 'dev' : 'combined', {
      stream: {
        write: (message: string) => logger.http(message.trim()),
      },
    }),
  );

  // ── Rate limiting ────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: rateLimitConfig.windowMs,
      max: rateLimitConfig.maxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please slow down.' },
      },
    }),
  );

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/', createRootRouter());

  // ── 404 handler (must be after routes) ──────────────────────────────────
  app.use(notFoundMiddleware);

  // ── Global error handler (must be last) ─────────────────────────────────
  app.use(errorMiddleware);

  return app;
}
