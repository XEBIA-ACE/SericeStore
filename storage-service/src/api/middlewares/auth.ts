import { Request, Response, NextFunction } from 'express';
import { AuthenticationError } from '../../core/errors/AppError';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('AuthMiddleware');

/**
 * Authentication middleware placeholder.
 *
 * When AUTH_ENABLED=true this validates a Bearer JWT in the Authorization
 * header. Replace the stub verification with your real JWT library
 * (e.g. jsonwebtoken, jose) and user-store lookup.
 *
 * When AUTH_ENABLED=false (default for local dev) the middleware is a no-op.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (!config.auth.enabled) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AuthenticationError('Missing or malformed Authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    // ── Replace this block with real JWT verification ──────────────────────
    // Example with jsonwebtoken:
    //   import jwt from 'jsonwebtoken';
    //   const payload = jwt.verify(token, config.auth.jwtSecret);
    //   (req as AuthenticatedRequest).user = payload;
    // ──────────────────────────────────────────────────────────────────────

    if (!token) {
      throw new AuthenticationError('Invalid token');
    }

    // Stub: accept any non-empty token in non-production environments
    if (config.app.env === 'production') {
      throw new AuthenticationError('JWT verification not implemented — plug in your auth provider');
    }

    log.debug('Auth bypassed (stub)', { token: token.slice(0, 8) + '…' });
    next();
  } catch (err) {
    if (err instanceof AuthenticationError) return next(err);
    next(new AuthenticationError('Token verification failed'));
  }
}
