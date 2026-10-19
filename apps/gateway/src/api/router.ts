import express from 'express';
import { csrfGuard } from '../auth/middleware.js';
import type { GatewayDeps } from '../server.js';
import { createAuthRouter } from './auth.routes.js';
import { ApiError, apiErrorHandler } from './errors.js';
import { createInvitesRouter } from './invites.routes.js';
import { createKeysRouter } from './keys.routes.js';
import { createUsersRouter } from './users.routes.js';

/** Order: json(100kb) → csrfGuard (mutating methods) → each route's requireSession/requireRole → handler. */
export function createApiRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '100kb' }));
  router.use(csrfGuard(deps.config.PUBLIC_APP_URL));

  router.use(createAuthRouter(deps));
  router.use(createInvitesRouter(deps));
  router.use(createUsersRouter(deps));
  router.use(createKeysRouter(deps));
  // Later tasks mount their routers here.

  router.use((_req, _res, next) => {
    next(new ApiError(404, 'NOT_FOUND', 'Not found'));
  });
  router.use(apiErrorHandler(deps.logger));
  return router;
}
