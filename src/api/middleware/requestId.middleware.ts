import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AppRequest } from '../../core/types';

/**
 * Attach a unique request-ID to every incoming request.
 * The ID is echoed back in the X-Request-Id response header so that clients
 * and downstream services can correlate log entries.
 */
export function requestIdMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  req.requestId = (req.headers['x-request-id'] as string | undefined) ?? uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
