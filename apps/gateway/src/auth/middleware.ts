import type { RequestHandler, Response } from 'express';
import { ApiError } from '../api/errors.js';
import type { GatewayDeps } from '../server.js';
import { findSessionUser, sessionTokenFrom } from './sessions.js';
import type { AuthUser } from './users.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for /api (spec §6.7): every mutating request needs `Content-Type: application/json`
 * AND an `Origin` equal to the origin of PUBLIC_APP_URL. Runs before any session check, and on public
 * routes too. The header is read directly because `req.is()` answers null for body-less requests.
 */
export function csrfGuard(publicAppUrl: string): RequestHandler {
  const origin = new URL(publicAppUrl).origin;
  return (req, _res, next) => {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json' || req.headers.origin !== origin) {
      next(new ApiError(403, 'CSRF_REJECTED', 'Request rejected by CSRF protection'));
      return;
    }
    next();
  };
}

/** Sets `res.locals.user` from a live `ugw_session` cookie, else 401 UNAUTHENTICATED (expired and disabled included). */
export function requireSession(deps: GatewayDeps): RequestHandler {
  return async (req, res, next) => {
    const token = sessionTokenFrom(req.headers.cookie);
    const user = token === null ? null : await findSessionUser(deps.db.db, token, deps.clock());
    if (!user) {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    res.locals.user = user;
    next();
  };
}

/** After requireSession: 403 FORBIDDEN unless the session user has the role. */
export function requireRole(role: 'admin'): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user as AuthUser | undefined;
    if (user?.role !== role) {
      next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to do this'));
      return;
    }
    next();
  };
}

/** The user requireSession put on the response. Throws if the route forgot requireSession. */
export function currentUser(res: Response): AuthUser {
  const user = res.locals.user as AuthUser | undefined;
  if (!user) throw new Error('currentUser() used on a route without requireSession');
  return user;
}
