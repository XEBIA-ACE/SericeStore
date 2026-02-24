/**
 * Global error-handling middleware.
 *
 * Must be registered LAST in the Express chain (after all routes).
 * Maps domain errors → HTTP status codes and returns a consistent JSON envelope.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? 'unknown';

  if (err instanceof AppError && err.isOperational) {
    // Known domain errors — safe to expose message to client
    logger.warn('Operational error', {
      requestId,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
    });

    const body: ErrorResponse = {
      success: false,
      error: { code: err.code, message: err.message },
      meta: { requestId, timestamp: new Date().toISOString() },
    };

    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected / programming errors — hide internals
  logger.error('Unhandled error', {
    requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  const body: ErrorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
    },
    meta: { requestId, timestamp: new Date().toISOString() },
  };

  res.status(500).json(body);
}

/** 404 fallback — must be registered before errorMiddleware. */
export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    meta: {
      requestId: (req.headers['x-request-id'] as string | undefined) ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  });
}
