import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { createStorageProvider } from './services/storage/StorageProviderFactory';
import { StorageService } from './services/storage/StorageService';
import fs from 'fs';

async function bootstrap(): Promise<void> {
  // Ensure temp directory exists
  fs.mkdirSync(config.TEMP_DIR, { recursive: true });

  // Initialize storage backend (create bucket if it doesn't exist)
  const storageProvider = createStorageProvider(config);
  const storageService = new StorageService(storageProvider);
  await storageService.initialize();
  logger.info(`Storage provider "${storageService.providerName}" initialized`);

  // Boot the HTTP server
  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(`Storage Service running`, {
      host: config.HOST,
      port: config.PORT,
      env: config.NODE_ENV,
      provider: config.STORAGE_PROVIDER,
      apiPrefix: config.API_PREFIX,
      docs: `http://${config.HOST}:${config.PORT}${config.API_PREFIX}/docs`,
    });
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal} — shutting down gracefully…`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force-quit after 10 s if connections are still open
    setTimeout(() => {
      logger.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    process.exit(1);
  });
}

bootstrap().catch((err: Error) => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});
