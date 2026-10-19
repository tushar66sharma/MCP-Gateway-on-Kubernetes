import { startMcpHttpServer, type Logger, type RunningMcpHttpServer } from '@urumi/shared';
import type { UtilitiesConfig } from './config.js';
import { registerUtilitiesTools } from './tools.js';

export interface StartOptions {
  config: UtilitiesConfig;
  logger: Logger;
  version: string;
  now?: () => Date;
  host?: string;
}

export function startUtilitiesServer(o: StartOptions): Promise<RunningMcpHttpServer> {
  const { config } = o;
  const deps = { defaultTimeZone: config.DEFAULT_TIMEZONE, now: o.now ?? (() => new Date()) };
  return startMcpHttpServer({
    name: 'mcp-utilities',
    version: o.version,
    port: config.PORT,
    host: o.host,
    auth: { kind: 'header', header: 'x-utilities-key', value: config.UTILITIES_KEY },
    logger: o.logger,
    allowedHosts: config.MCP_ALLOWED_HOSTS,
    registerTools: (s) => { registerUtilitiesTools(s, deps); },
    readinessCheck: () => Promise.resolve(true),
  });
}
