import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../utils/logger';

const log = createLogger('RequestLogger');

/**
 * Attaches a unique request ID to each request and logs incoming requests
 * together with their response status and latency.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);

  const start = Date.now();

  res.on('finish', () => {
    const latency = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    log[level]('HTTP request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs: latency,
      contentLength: res.getHeader('content-length'),
      userAgent: req.get('user-agent'),
    });
  });

  next();
}
