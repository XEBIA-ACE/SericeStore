/**
 * JWT authentication middleware.
 *
 * When AUTH_ENABLED=true every protected route requires a valid Bearer token.
 * Set AUTH_ENABLED=false during local development / testing to bypass auth.
 *
 * Extend this module to integrate with an identity provider (Cognito, Auth0, etc.)
 * by replacing the local JWT verification with an JWKS-based one.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authConfig } from '../../config';
import { JwtPayload } from '../../core/types';
import { UnauthorizedError } from '../../utils/errors';
import logger from '../../utils/logger';

// Augment Express Request to carry the decoded token payload
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!authConfig.enabled) {
    // Auth disabled — attach a synthetic anonymous principal
    req.user = { sub: 'anonymous' };
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Authorization header is missing or malformed'));
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    req.user = payload;
    logger.debug('Auth: token verified', { sub: payload.sub });
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token has expired'));
    } else if (err instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(err);
    }
  }
}

/**
 * Role guard factory.
 * Usage: router.delete('/:key', authMiddleware, requireRole('admin'), handler)
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles ?? [];
    const hasRole = roles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      next(new UnauthorizedError(`One of the following roles is required: ${roles.join(', ')}`));
      return;
    }
    next();
  };
}
