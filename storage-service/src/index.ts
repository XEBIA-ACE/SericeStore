/**
 * Service entry point.
 *
 * Starts the HTTP server after ensuring the configured storage bucket exists.
 */

import 'dotenv/config'; // must be the first import
import http from 'http';
import { createApp } from './app';
import { appConfig } from './config';
import { getStorageProvider } from './services/storage/storage.factory';
import { storageConfig } from './config';
import logger from './utils/logger';

async function main(): Promise<void> {
  // ── Ensure default bucket exists ────────────────────────────────────────
  try {
    const provider = getStorageProvider();
    const defaultBucket =
      storageConfig.provider === 's3'
        ? (await import('./config')).s3Config.bucket
        : storageConfig.provider === 'gcs'
        ? (await import('./config')).gcsConfig.bucket
        : (await import('./config')).minioConfig.bucket;

    await provider.ensureBucket(defaultBucket);
    logger.info(`Default bucket ready: ${defaultBucket}`);
  } catch (err) {
    logger.warn('Could not ensure default bucket — verify provider credentials', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Start HTTP server ────────────────────────────────────────────────────
  const app = createApp();
  const server = http.createServer(app);

  server.listen(appConfig.port, () => {
    logger.info(`${appConfig.serviceName} listening`, {
      port: appConfig.port,
      env: appConfig.env,
      provider: storageConfig.provider,
      docs: `http://localhost:${appConfig.port}/api/docs`,
    });
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (signal: string): void => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force kill after 30 s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

void main();
