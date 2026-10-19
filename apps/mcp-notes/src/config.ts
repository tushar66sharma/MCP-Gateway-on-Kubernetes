import { EnvValidationError, loadEnv } from '@urumi/shared';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  MCP_AUTH_TOKEN: z.string().min(16),
  LOG_LEVEL: z.string().default('info'),
  MCP_ALLOWED_HOSTS: z
    .string()
    .default('localhost,127.0.0.1')
    .transform((s) => s.split(',').map((h) => h.trim()).filter((h) => h.length > 0)),
});

export type NotesConfig = z.infer<typeof schema>;

/** Throws EnvValidationError (variable names only, never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NotesConfig {
  const cfg = loadEnv(schema, env);
  if (cfg.MCP_ALLOWED_HOSTS.length === 0) {
    throw new EnvValidationError(['MCP_ALLOWED_HOSTS (must list at least one host)']);
  }
  return cfg;
}
