/**
 * Attaches a unique request ID to every incoming request.
 * The ID is echoed back in the X-Request-Id response header.
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string | undefined) ?? uuidv4();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
