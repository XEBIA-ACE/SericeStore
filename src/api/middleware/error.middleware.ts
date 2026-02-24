import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../../core/errors/AppError';
import { ApiResponse, AppRequest } from '../../core/types';
import { logger } from '../../utils/logger';

/**
 * 404 handler — catches requests that didn't match any route.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  } satisfies ApiResponse);
}

/**
 * Global error handler.
 * Express identifies this as an error handler because it has 4 parameters.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as AppRequest).requestId ?? 'unknown';

  // ── Zod validation errors ──────────────────────────────────────────────────
  if (err instanceof ZodError) {
    const appErr = new ValidationError('Validation failed', err.flatten());
    res.status(appErr.statusCode).json({
      success: false,
      error: { code: appErr.errorCode, message: appErr.message, details: appErr.details },
      meta: { requestId, timestamp: new Date().toISOString() },
    } satisfies ApiResponse);
    return;
  }

  // ── Known operational errors ───────────────────────────────────────────────
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error('Non-operational AppError', { requestId, error: err.message, stack: err.stack });
    }
    const body: ApiResponse = {
      success: false,
      error: { code: err.errorCode, message: err.message },
      meta: { requestId, timestamp: new Date().toISOString() },
    };
    if (err instanceof ValidationError) {
      body.error!.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  // ── Unknown / unexpected errors ────────────────────────────────────────────
  logger.error('Unexpected error', {
    requestId,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    meta: { requestId, timestamp: new Date().toISOString() },
  } satisfies ApiResponse);
}
