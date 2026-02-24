import 'dotenv/config';
import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';

const app = createApp();

const server = app.listen(config.app.port, () => {
  logger.info('Storage service started', {
    port: config.app.port,
    env: config.app.env,
    provider: config.storage.provider,
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully…`);

  server.close((err) => {
    if (err) {
      logger.error('Error during server close', { err });
      process.exit(1);
    }
    logger.info('Server closed');
    process.exit(0);
  });

  // Force-kill after 30 s if connections don't drain
  setTimeout(() => {
    logger.error('Forceful shutdown after timeout');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Unhandled rejections / exceptions ────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  process.exit(1);
});

export default server;
