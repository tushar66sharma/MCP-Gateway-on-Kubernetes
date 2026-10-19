import { readFileSync } from 'node:fs';
import { EnvValidationError, createLogger } from '@urumi/shared';
import { loadConfig, type NotesConfig } from './config.js';
import { startNotesServer } from './server.js';

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

let config: NotesConfig;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof EnvValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger('mcp-notes', config.LOG_LEVEL);
const server = await startNotesServer({ config, logger, version });
logger.info(
  {
    name: 'mcp-notes',
    version,
    port: server.port,
  },
  'mcp-notes started',
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
