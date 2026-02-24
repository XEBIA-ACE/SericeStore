import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, json, simple, colorize, printf } = winston.format;

const simpleFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${String(ts)} [${level}]: ${String(message)}${metaStr}`;
  }),
);

const jsonFormat = combine(timestamp(), json());

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: config.LOG_FORMAT === 'json' ? jsonFormat : simpleFormat,
  defaultMeta: { service: 'storage-service' },
  transports: [
    new winston.transports.Console(),
    // In production you may add File or external transports here
  ],
  exitOnError: false,
});
