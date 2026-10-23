import { readFileSync } from 'node:fs';
import { EnvValidationError, createLogger } from '@urumi/shared';
import { loadConfig, type Config } from './config.js';
import { startWooMcpServer } from './server.js';

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

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

const logger = createLogger('mcp-woocommerce', config.LOG_LEVEL);
const server = await startWooMcpServer({ config, logger, version });
logger.info(
  {
    name: 'mcp-woocommerce',
    version,
    port: server.port,
    wooBaseUrl: config.WOO_BASE_URL,
    wooAuthMode: config.WOO_AUTH_MODE,
    wooSigningBaseUrl: config.WOO_SIGNING_BASE_URL,
    storeTimeZone: config.STORE_TIMEZONE,
  },
  'mcp-woocommerce started',
);

let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  server.close().then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'error during shutdown');
      process.exit(0);
    },
  );
}
process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
