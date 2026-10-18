import { EnvValidationError, loadEnv } from '@urumi/shared';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WOO_BASE_URL: z.url(),
  WOO_SIGNING_BASE_URL: z.url(),
  WOO_CONSUMER_KEY: z.string().min(10),
  WOO_CONSUMER_SECRET: z.string().min(10),
  MCP_AUTH_TOKEN: z.string().min(16),
  STORE_TIMEZONE: z.string().default('UTC'),
  WOO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  LOG_LEVEL: z.string().default('info'),
  MCP_ALLOWED_HOSTS: z
    .string()
    .default('localhost,127.0.0.1')
    .transform((s) => s.split(',').map((h) => h.trim()).filter((h) => h.length > 0)),
});

export type Config = z.infer<typeof schema>;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Throws EnvValidationError (variable names only, never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = loadEnv(schema, env);
  const issues: string[] = [];
  if (!validTimeZone(cfg.STORE_TIMEZONE)) {
    issues.push('STORE_TIMEZONE (must be an IANA time zone such as Asia/Kolkata or UTC)');
  }
  if (!cfg.WOO_SIGNING_BASE_URL.startsWith('http://')) {
    issues.push('WOO_SIGNING_BASE_URL (must start with http://, WooCommerce signs against the http home URL)');
  }
  if (cfg.MCP_ALLOWED_HOSTS.length === 0) {
    issues.push('MCP_ALLOWED_HOSTS (must list at least one host)');
  }
  if (issues.length > 0) throw new EnvValidationError(issues);
  return cfg;
}
