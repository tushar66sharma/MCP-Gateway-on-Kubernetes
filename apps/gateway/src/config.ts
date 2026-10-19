import { z } from 'zod';
import { loadEnv } from '@urumi/shared';

export interface SeedServer {
  slug: string;
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'header';
  authHeaderName?: string;
  credentialEnv?: string;
}

export interface Config {
  PORT: number;
  LOG_LEVEL: string;
  PUBLIC_APP_URL: string;
  COOKIE_SECURE: boolean;
  MCP_ALLOWED_HOSTS: string[];
  GATEWAY_ENCRYPTION_KEY: Buffer;
  GATEWAY_INTERNAL_TOKEN_SECRET: string;
  BOOTSTRAP_ADMIN_EMAIL: string;
  BOOTSTRAP_ADMIN_PASSWORD: string;
  SEED_SERVERS: SeedServer[];
  SSRF_ALLOWED_INTERNAL_HOSTS: string[];
  SSRF_ALLOW_LOOPBACK: boolean;
  UPSTREAM_HEALTH_INTERVAL_MS: number;
  UPSTREAM_HEALTH_TIMEOUT_MS: number;
  UPSTREAM_CALL_TIMEOUT_MS: number;
}

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const intRange = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

const seedServerSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,15}$/),
  name: z.string().min(1).max(100),
  url: z.url(),
  authType: z.enum(['none', 'bearer', 'header']),
  authHeaderName: z.string().min(1).optional(),
  credentialEnv: z.string().min(1).optional(),
});

const encryptionKey = z.string().transform((v, ctx) => {
  const buf = Buffer.from(v, 'base64');
  // Round-trip check rejects strings that are not canonical base64.
  if (buf.length !== 32 || buf.toString('base64') !== v.trim()) {
    ctx.addIssue({ code: 'custom', message: 'must be base64 of exactly 32 bytes' });
    return z.NEVER;
  }
  return buf;
});

const seedServers = z
  .string()
  .default('[]')
  .transform((v, ctx) => {
    let json: unknown;
    try {
      json = JSON.parse(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be JSON' });
      return z.NEVER;
    }
    const parsed = z.array(seedServerSchema).safeParse(json);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: 'invalid seed server list' });
      return z.NEVER;
    }
    return parsed.data satisfies SeedServer[];
  });

const appSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_APP_URL: z.url(),
  COOKIE_SECURE: bool,
  MCP_ALLOWED_HOSTS: csv('localhost,127.0.0.1'),
  GATEWAY_ENCRYPTION_KEY: encryptionKey,
  GATEWAY_INTERNAL_TOKEN_SECRET: z.string().min(32),
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).max(200),
  SEED_SERVERS: seedServers,
  SSRF_ALLOWED_INTERNAL_HOSTS: csv('*.mcp.svc.cluster.local'),
  SSRF_ALLOW_LOOPBACK: bool,
  UPSTREAM_HEALTH_INTERVAL_MS: intRange(15000, 1000, 300000),
  UPSTREAM_HEALTH_TIMEOUT_MS: intRange(5000, 500, 60000),
  UPSTREAM_CALL_TIMEOUT_MS: intRange(20000, 1000, 120000),
});

// Read by `pg` itself; required here so a misconfigured pod fails at startup with the variable named.
const pgSchema = z.object({
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().min(1).max(65535).default(5432),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
});

const envSchema = appSchema.extend(pgSchema.shape);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Parse once so every problem is reported together, then return only the app settings.
  loadEnv(envSchema, env);
  return loadEnv(appSchema, env);
}
