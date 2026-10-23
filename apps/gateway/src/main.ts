import { EnvValidationError, createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { ensureBootstrapAdmin } from './auth/bootstrap.js';
import { FixedWindowLimiter } from './auth/rateLimit.js';
import { createLlmFromConfig, createTopicCheckLlm, llmStatusOf } from './chat/llm/registry.js';
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

// 2. Postgres: open + ping + migrate, 90 attempts 2 s apart; /mcp is never served on an unmigrated DB.
let db: DbHandle;
try {
  db = await connectWithRetry(() => Promise.resolve(createPostgresHandle(logger)), { attempts: 90, delayMs: 2000, logger });
} catch (err) {
  fail('database', err);
}

let server: RunningMcpHttpServer;
const services = createUpstreamServices(config, logger, db);
// The chat model: provider and model names only, never a key. Without a key chat answers LLM_NOT_CONFIGURED.
const llm = createLlmFromConfig(config);
const topicLlm = createTopicCheckLlm(config);
const llmStatus = llmStatusOf(config);
if (llm) logger.info({ provider: llm.name, model: llm.model, fallbackProvider: llmStatus.fallbackProvider }, `llm configured: ${llm.name}/${llm.model}`);
else logger.warn({ provider: llmStatus.provider }, 'llm not configured: chat is disabled (no API key for the provider)');
if (topicLlm) logger.info({ provider: topicLlm.name, model: topicLlm.model, dailyTokenBudget: config.CHAT_DAILY_TOKEN_BUDGET }, `topic check configured: ${topicLlm.name}/${topicLlm.model}`);
else logger.info({ dailyTokenBudget: config.CHAT_DAILY_TOKEN_BUDGET }, 'topic check off');
try {
  // 3. First admin, only when the users table is empty.
  await ensureBootstrapAdmin(db.db, config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD, logger);
  // 4. Seed servers, each slug once ever (seeded_slugs), so a deleted built-in server stays deleted;
  //    credentials come from the env vars the seeds name.
  const seeded = await seedUpstreams(db.db, config.SEED_SERVERS, process.env, config.GATEWAY_ENCRYPTION_KEY, logger);
  // 5. One health check per server, then the 15 s interval.
  await services.upstreams.start();
  // 6. Listen.
  server = await startGateway(
    { config, logger, db, clock, rateLimiter: new FixedWindowLimiter({ max: 10, windowMs: 60_000, clock }), mcpAuthLimiter: new FixedWindowLimiter({ max: config.MCP_AUTH_FAILURE_LIMIT_PER_MIN, windowMs: 60_000, clock }), ...services, llm, topicLlm },
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

// 8. Shutdown (final-review M1): stop accepting connections, let in-flight requests (tool calls) finish
//    for up to 25 s, cut what is left, then stop the upstream clients, close the pool and exit 0.
//    The chart gives the pod 35 s in all (terminationGracePeriodSeconds): a 5 s preStop sleep, then
//    SIGTERM, so 5 + 25 s fits with room for the last steps.
const SHUTDOWN_GRACE_MS = 25_000;
let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal, inFlight: server.inFlight(), graceMs: SHUTDOWN_GRACE_MS }, 'shutting down: no new connections');
  try {
    const { cutRequests } = await server.close({ graceMs: SHUTDOWN_GRACE_MS });
    logger.info({ cutRequests }, 'shutdown: http server closed');
    await services.upstreams.stop();
    logger.info('shutdown: upstream clients stopped');
    await db.close();
    logger.info('shutdown: database pool closed; exiting');
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
