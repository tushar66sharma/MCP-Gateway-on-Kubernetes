import { readFileSync } from 'node:fs';
import { EnvValidationError, createLogger } from '@urumi/shared';
import { loadConfig, type UtilitiesConfig } from './config.js';
import { startUtilitiesServer } from './server.js';

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

let config: UtilitiesConfig;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger('mcp-utilities', config.LOG_LEVEL);
const server = await startUtilitiesServer({ config, logger, version });
logger.info(
  {
    name: 'mcp-utilities',
    version,
    port: server.port,
    defaultTimeZone: config.DEFAULT_TIMEZONE,
  },
  'mcp-utilities started',
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
