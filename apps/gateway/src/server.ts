import { McpServer } from '@modelcontextprotocol/server';
import type { RequestHandler } from 'express';
import { startMcpHttpServer, type Logger, type RunningMcpHttpServer } from '@urumi/shared';
import { createApiRouter } from './api/router.js';
import type { LoginRateLimiter } from './auth/rateLimit.js';
import type { Config } from './config.js';
import type { DbHandle } from './db/client.js';

export interface GatewayDeps {
  config: Config;
  logger: Logger;
  db: DbHandle;
  clock: () => Date;
  rateLimiter: LoginRateLimiter;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Invite tokens travel in the URL path; never write them to the request log. */
export function sanitizeLogPath(path: string): string {
  return path.replace(/(\/api\/invites\/)([^/]+)/, (_m, prefix: string, seg: string) => (UUID.test(seg) ? `${prefix}${seg}` : `${prefix}:token`));
}

// Placeholder until Task 3.7 wires the real /mcp auth.
const rejectAll: RequestHandler = (_req, res) => {
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
};

export function startGateway(deps: GatewayDeps, listen: { port: number; host?: string }): Promise<RunningMcpHttpServer> {
  return startMcpHttpServer({
    name: 'urumi-gateway',
    version: '0.1.0',
    port: listen.port,
    ...(listen.host !== undefined ? { host: listen.host } : {}),
    auth: rejectAll,
    logger: deps.logger,
    allowedHosts: deps.config.MCP_ALLOWED_HOSTS,
    buildServer: () => new McpServer({ name: 'urumi-gateway', version: '0.1.0' }),
    extraRoutes: (app) => {
      app.use('/api', createApiRouter(deps));
    },
    logPath: sanitizeLogPath,
    readinessCheck: () => deps.db.ping(),
  });
}
