import express from 'express';
import { csrfGuard } from '../auth/middleware.js';
import type { GatewayDeps } from '../server.js';
import { createAuditRouter } from './audit.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createChatRouter } from './chat.routes.js';
import { ApiError, apiErrorHandler } from './errors.js';
import { createInvitesRouter } from './invites.routes.js';
import { createKeysRouter } from './keys.routes.js';
import { createServersRouter } from './servers.routes.js';
import { createUsersRouter } from './users.routes.js';

/**
 * Order: headers → json(100kb, skipped for /chat) → csrfGuard (mutating methods, headers only) → each route's
 * requireSession/requireRole → handler. The chat route parses its own 512 KB body after requireSession, so an
 * anonymous client cannot make the server buffer half a megabyte.
 * `mcpUrl` is the gateway's own /mcp on loopback, for the chat agent (known once the server listens).
 */
export function createApiRouter(deps: GatewayDeps, mcpUrl: () => string): express.Router {
  const router = express.Router();
  // Every /api response, errors included: JSON is never sniffed as something else, and never cached.
  router.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // A chat body may hold 20 messages of 4000 characters; in a non-Latin script that is ~240 KB of UTF-8
  // (JSON escapes can double it), so POST /chat parses a 512 KB body itself, after requireSession. The general
  // 100 KB parser skips it. Express routing ignores case, so the test lowercases the path too (/api/CHAT).
  const json100 = express.json({ limit: '100kb' });
  router.use((req, res, next) => {
    if (req.path.toLowerCase().startsWith('/chat')) next();
    else json100(req, res, next);
  });
  router.use(csrfGuard(deps.config.PUBLIC_APP_URL));

  router.use(createAuthRouter(deps));
  router.use(createInvitesRouter(deps));
  router.use(createUsersRouter(deps));
  router.use(createKeysRouter(deps));
  router.use(createServersRouter(deps));
  router.use(createAuditRouter(deps));
  router.use(createChatRouter(deps, mcpUrl));

  router.use((_req, _res, next) => {
    next(new ApiError(404, 'NOT_FOUND', 'Not found'));
  });
  router.use(apiErrorHandler(deps.logger));
  return router;
}
