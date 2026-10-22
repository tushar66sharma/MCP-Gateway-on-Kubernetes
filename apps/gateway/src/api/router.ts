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
 * Order: headers → json(100kb) → csrfGuard (mutating methods) → each route's requireSession/requireRole → handler.
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
  // (JSON escapes can double it). Parsed here first, the general 100 KB parser then skips it.
  router.use('/chat', express.json({ limit: '512kb' }));
  router.use(express.json({ limit: '100kb' }));
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
