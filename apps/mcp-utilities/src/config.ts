import { EnvValidationError, loadEnv } from '@urumi/shared';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3003),
  UTILITIES_KEY: z.string().min(16),
  DEFAULT_TIMEZONE: z.string().default('UTC'),
  LOG_LEVEL: z.string().default('info'),
  MCP_ALLOWED_HOSTS: z
    .string()
    .default('localhost,127.0.0.1')
    .transform((s) => s.split(',').map((h) => h.trim()).filter((h) => h.length > 0)),
});

export type UtilitiesConfig = z.infer<typeof schema>;

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Throws EnvValidationError (variable names only, never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): UtilitiesConfig {
  const cfg = loadEnv(schema, env);
  const issues: string[] = [];
  if (!validTimeZone(cfg.DEFAULT_TIMEZONE)) {
    issues.push('DEFAULT_TIMEZONE (must be an IANA time zone such as Asia/Kolkata or UTC)');
  }
  if (cfg.MCP_ALLOWED_HOSTS.length === 0) {
    issues.push('MCP_ALLOWED_HOSTS (must list at least one host)');
  }
  if (issues.length > 0) throw new EnvValidationError(issues);
  return cfg;
}
