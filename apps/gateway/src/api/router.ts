import express from 'express';
import type { GatewayDeps } from '../server.js';
import { ApiError, apiErrorHandler } from './errors.js';

export function createApiRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '100kb' }));

  // Later tasks mount their routers here.

  router.use((_req, _res, next) => {
    next(new ApiError(404, 'NOT_FOUND', 'Not found'));
  });
  router.use(apiErrorHandler(deps.logger));
  return router;
}
