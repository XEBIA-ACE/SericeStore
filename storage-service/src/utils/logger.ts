/**
 * Structured logger built on Winston.
 *
 * Log format:
 *  - Development: coloured, human-readable console output
 *  - Production : JSON with daily-rotating file transport
 *
 * Usage:
 *   import logger from '@utils/logger';
 *   logger.info('File uploaded', { key, size });
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { appConfig } from '../config';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ─── Custom Formats ───────────────────────────────────────────────────────────

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${String(ts)} [${level}] ${String(message)}${metaStr}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

// ─── Transports ───────────────────────────────────────────────────────────────

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: appConfig.isDev ? devFormat : prodFormat,
  }),
];

if (appConfig.isProd) {
  // Rotate log files daily in production
  transports.push(
    new DailyRotateFile({
      filename: 'logs/%DATE%-combined.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: prodFormat,
    }),
    new DailyRotateFile({
      filename: 'logs/%DATE%-error.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      format: prodFormat,
    }),
  );
}

// ─── Logger Instance ──────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: appConfig.logLevel,
  defaultMeta: { service: appConfig.serviceName },
  transports,
  // Prevent winston from exiting on unhandled exceptions in tests
  exitOnError: false,
});

export default logger;

// ─── Request Logger Helper ────────────────────────────────────────────────────

/**
 * Returns a child logger scoped to a specific request.
 * Attach requestId for distributed tracing.
 */
export function requestLogger(requestId: string): winston.Logger {
  return logger.child({ requestId });
}
