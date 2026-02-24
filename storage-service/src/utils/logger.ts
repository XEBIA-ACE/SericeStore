import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isProduction = config.app.env === 'production';

/**
 * Structured logger using Winston.
 * In production: JSON output to rotating files + console.
 * In development: colorized human-readable console output.
 */
export const logger = winston.createLogger({
  level: config.app.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    json(),
  ),
  defaultMeta: { service: 'storage-service' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: isProduction
        ? combine(timestamp(), json())
        : combine(colorize(), simple()),
    }),

    // Rotating file transport for errors
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // Rotating file transport for all logs
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '7d',
      zippedArchive: true,
    }),
  ],
});

/**
 * Create a child logger scoped to a specific module.
 */
export function createLogger(module: string): winston.Logger {
  return logger.child({ module });
}
