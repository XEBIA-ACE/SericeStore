import { Response, NextFunction } from 'express';
import { AppRequest } from '../../core/types';
import { AuthenticationError } from '../../core/errors/AppError';
import { config } from '../../config';

/**
 * Bearer-token authentication middleware.
 *
 * Validates the Authorization header against the API_SECRET_KEY environment
 * variable.  In a real production system this would be replaced with JWT
 * verification, an OAuth introspection call, or a session lookup.
 *
 * Expected header: Authorization: Bearer <API_SECRET_KEY>
 */
export function authMiddleware(req: AppRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AuthenticationError('Missing or malformed Authorization header'));
  }

  const token = authHeader.slice(7).trim();

  if (token !== config.API_SECRET_KEY) {
    return next(new AuthenticationError('Invalid API key'));
  }

  // Attach a minimal user object for downstream middleware / controllers
  req.user = { id: 'api-key-user', roles: ['admin'] };

  next();
}
