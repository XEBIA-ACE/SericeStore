import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError } from '../../core/errors/AppError';
import { createLogger } from '../../utils/logger';

const log = createLogger('ErrorHandler');

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Global Express error handler.
 * Maps domain errors to appropriate HTTP responses and shields internal
 * details from the client in production.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string) ?? 'unknown';
  const isProduction = process.env.NODE_ENV === 'production';

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error('Operational error', { err, requestId, path: req.path });
    } else {
      log.warn('Client error', {
        code: err.code,
        message: err.message,
        requestId,
        path: req.path,
      });
    }

    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    };

    if (err instanceof ValidationError && err.details) {
      body.error.details = err.details;
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // Unknown / unhandled error — do not leak internals in production
  log.error('Unexpected error', { err, requestId, path: req.path });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'An unexpected error occurred' : err.message,
      requestId,
    },
  });
}

/**
 * Catch-all 404 handler. Must be registered after all routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
