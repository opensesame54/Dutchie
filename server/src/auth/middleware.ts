import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './tokens';
import { ApiError } from '../errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Missing or malformed Authorization header'));
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    req.userId = payload.sub;
    next();
  } catch {
    // Deliberately vague: distinguishing "expired" from "invalid" to an
    // unauthenticated caller is free information for an attacker.
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function currentUserId(req: Request): string {
  if (!req.userId) {
    throw new ApiError(401, 'Not authenticated');
  }
  return req.userId;
}
