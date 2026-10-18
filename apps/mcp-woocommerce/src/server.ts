import { startMcpHttpServer, type Logger, type RunningMcpHttpServer } from '@urumi/shared';
import type { Config } from './config.js';
import { registerWooTools } from './tools/index.js';
import { WooClient, type WooApi } from './woo/client.js';

export interface StartOptions {
  config: Config;
  logger: Logger;
  version: string;
  /** Test seam; defaults to the real OAuth1 client. */
  woo?: WooApi;
  now?: () => Date;
  host?: string;
}

export function startWooMcpServer(o: StartOptions): Promise<RunningMcpHttpServer> {
  const { config } = o;
  const woo = o.woo ?? new WooClient({
    baseUrl: config.WOO_BASE_URL,
    signingBaseUrl: config.WOO_SIGNING_BASE_URL,
    consumerKey: config.WOO_CONSUMER_KEY,
    consumerSecret: config.WOO_CONSUMER_SECRET,
    timeoutMs: config.WOO_TIMEOUT_MS,
  });
  const deps = { woo, storeTimeZone: config.STORE_TIMEZONE, now: o.now ?? (() => new Date()) };
  return startMcpHttpServer({
    name: 'mcp-woocommerce',
    version: o.version,
    port: config.PORT,
    host: o.host,
    auth: { kind: 'bearer', token: config.MCP_AUTH_TOKEN },
    logger: o.logger,
    allowedHosts: config.MCP_ALLOWED_HOSTS,
    registerTools: (s) => registerWooTools(s, deps),
    readinessCheck: () => Promise.resolve(true), // never calls WooCommerce
  });
}
