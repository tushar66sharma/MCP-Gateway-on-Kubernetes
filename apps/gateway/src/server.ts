import { startMcpHttpServer, type Logger, type RunningMcpHttpServer } from '@urumi/shared';
import { createApiRouter } from './api/router.js';
import { AuditWriter } from './audit/writer.js';
import type { LoginRateLimiter } from './auth/rateLimit.js';
import { ssrfOptionsOf, type Config } from './config.js';
import type { DbHandle } from './db/client.js';
import { createMcpAuth } from './mcp/auth.js';
import { createGatewayMcpServer } from './mcp/endpoint.js';
import { UpstreamManager } from './upstreams/manager.js';
import { UpstreamRepository } from './upstreams/repository.js';
import { GATEWAY_VERSION } from './version.js';

export interface GatewayDeps {
  config: Config;
  logger: Logger;
  db: DbHandle;
  clock: () => Date;
  rateLimiter: LoginRateLimiter;
  upstreams: UpstreamManager;
  audit: AuditWriter;
  repo: UpstreamRepository;
}

/** The repository, audit writer and (not yet started) upstream manager over one database. */
export function createUpstreamServices(config: Config, logger: Logger, db: DbHandle): Pick<GatewayDeps, 'upstreams' | 'audit' | 'repo'> {
  const repo = new UpstreamRepository(db.db);
  const audit = new AuditWriter(db.db, logger);
  const upstreams = new UpstreamManager({
    repo,
    audit,
    logger,
    encKey: config.GATEWAY_ENCRYPTION_KEY,
    ssrf: ssrfOptionsOf(config),
    healthIntervalMs: config.UPSTREAM_HEALTH_INTERVAL_MS,
    healthTimeoutMs: config.UPSTREAM_HEALTH_TIMEOUT_MS,
    callTimeoutMs: config.UPSTREAM_CALL_TIMEOUT_MS,
  });
  return { upstreams, audit, repo };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Invite tokens travel in the URL path; never write them to the request log. */
export function sanitizeLogPath(path: string): string {
  return path.replace(/(\/api\/invites\/)([^/]+)/, (_m, prefix: string, seg: string) => (UUID.test(seg) ? `${prefix}${seg}` : `${prefix}:token`));
}

export function startGateway(deps: GatewayDeps, listen: { port: number; host?: string }): Promise<RunningMcpHttpServer> {
  return startMcpHttpServer({
    name: 'urumi-gateway',
    version: GATEWAY_VERSION,
    port: listen.port,
    ...(listen.host !== undefined ? { host: listen.host } : {}),
    auth: createMcpAuth(deps),
    logger: deps.logger,
    allowedHosts: deps.config.MCP_ALLOWED_HOSTS,
    buildServer: createGatewayMcpServer(deps),
    extraRoutes: (app) => {
      // Number of reverse proxies in front of the gateway whose X-Forwarded-For is believed. Only req.ip
      // depends on it, and req.ip is only the login rate-limit key. 0 (default) = the socket peer; Helm
      // sets 1 (Task 3.8) because Traefik is exactly one hop. Too high a value lets a client pick its own
      // rate-limit bucket by sending X-Forwarded-For.
      app.set('trust proxy', deps.config.TRUST_PROXY);
      app.use('/api', createApiRouter(deps));
    },
    logPath: sanitizeLogPath,
    readinessCheck: () => deps.db.ping(),
  });
}
