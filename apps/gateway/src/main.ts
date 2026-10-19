import { EnvValidationError, createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { ensureBootstrapAdmin } from './auth/bootstrap.js';
import { LoginRateLimiter } from './auth/rateLimit.js';
import { loadConfig, type Config } from './config.js';
import { connectWithRetry, createPostgresHandle, type DbHandle } from './db/client.js';
import { createUpstreamServices, startGateway } from './server.js';
import { seedUpstreams } from './upstreams/seed.js';
import { GATEWAY_VERSION } from './version.js';

// 1. Config. An env error names the variables only, never their values.
let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger('gateway', config.LOG_LEVEL);
const clock = () => new Date();

/** Startup failures: the error class only (driver and SDK messages can embed connection details). */
function fail(step: string, err: unknown): never {
  logger.error({ step, reason: err instanceof Error ? err.name : 'UnknownError' }, 'gateway startup failed');
  process.exit(1);
}

// 2. Postgres: open + ping + migrate, 30 attempts 2 s apart; /mcp is never served on an unmigrated DB.
let db: DbHandle;
try {
  db = await connectWithRetry(() => Promise.resolve(createPostgresHandle(logger)), { attempts: 30, delayMs: 2000, logger });
} catch (err) {
  fail('database', err);
}

let server: RunningMcpHttpServer;
const services = createUpstreamServices(config, logger, db);
try {
  // 3. First admin, only when the users table is empty.
  await ensureBootstrapAdmin(db.db, config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD, logger);
  // 4. Seed servers, insert-if-absent by slug; credentials come from the env vars the seeds name.
  const seeded = await seedUpstreams(services.repo, config.SEED_SERVERS, process.env, config.GATEWAY_ENCRYPTION_KEY, logger);
  // 5. One health check per server, then the 15 s interval.
  await services.upstreams.start();
  // 6. Listen.
  server = await startGateway(
    { config, logger, db, clock, rateLimiter: new LoginRateLimiter({ max: 10, windowMs: 60_000, clock }), ...services },
    { port: config.PORT },
  );
  // 7. No secrets: port, slugs and counts only.
  logger.info(
    {
      version: GATEWAY_VERSION,
      port: server.port,
      seededSlugs: config.SEED_SERVERS.map((s) => s.slug),
      seedInserted: seeded.inserted,
      upstreams: (await services.repo.list()).length,
      connectedTools: services.upstreams.listTools().length,
    },
    'gateway started',
  );
} catch (err) {
  await services.upstreams.stop().catch(() => {});
  await db.close().catch(() => {});
  fail('startup', err);
}

// 8. Shutdown: stop health checks and upstream clients, stop listening, close the pool, exit 0.
let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  try {
    await services.upstreams.stop();
    await server.close();
    await db.close();
  } catch (err) {
    logger.error({ reason: err instanceof Error ? err.name : 'UnknownError' }, 'error during shutdown');
  }
  process.exit(0);
}
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
