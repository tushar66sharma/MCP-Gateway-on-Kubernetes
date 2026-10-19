import { z } from 'zod';
import { loadEnv } from '@urumi/shared';
import type { SsrfOptions } from './security/ssrf.js';

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
  /** Express 'trust proxy' hop count: 0 trusts no X-Forwarded-For; 1 = one reverse proxy (Traefik) in front. */
  TRUST_PROXY: number;
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

const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An SSRF allowlist entry is `*.<suffix>` with at least two labels after the wildcard, or an exact name
 * with at least one dot. A bare `*.`, `*.local` or `localhost` would let private addresses through for
 * far more names than intended.
 */
export function isValidAllowlistEntry(entry: string): boolean {
  const wildcard = entry.startsWith('*.');
  const labels = (wildcard ? entry.slice(2) : entry).split('.');
  return labels.length >= 2 && labels.every((l) => DNS_LABEL.test(l));
}

const allowlist = csv('*.mcp.svc.cluster.local').superRefine((entries, ctx) => {
  entries.forEach((entry, i) => {
    // The index only, never the value (loadEnv reports SSRF_ALLOWED_INTERNAL_HOSTS.<i>).
    if (!isValidAllowlistEntry(entry)) ctx.addIssue({ code: 'custom', path: [i], message: 'invalid allowlist entry' });
  });
});

const seedServerSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,15}$/),
  name: z.string().min(1).max(100),
  url: z.url(),
  authType: z.enum(['none', 'bearer', 'header']),
  authHeaderName: z.string().min(1).optional(),
  credentialEnv: z.string().min(1).optional(),
}).superRefine((v, ctx) => {
  if (v.authType === 'header' && !/^[A-Za-z0-9-]{1,64}$/.test(v.authHeaderName ?? '')) {
    ctx.addIssue({ code: 'custom', path: ['authHeaderName'], message: 'required for header auth' });
  }
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
      // Issue paths only (e.g. SEED_SERVERS.1.authHeaderName), never the values.
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: 'invalid seed server' });
      }
      return z.NEVER;
    }
    return parsed.data satisfies SeedServer[];
  });

const appFields = z.object({
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
  SSRF_ALLOWED_INTERNAL_HOSTS: allowlist,
  SSRF_ALLOW_LOOPBACK: bool,
  UPSTREAM_HEALTH_INTERVAL_MS: intRange(15000, 1000, 300000),
  UPSTREAM_HEALTH_TIMEOUT_MS: intRange(5000, 500, 60000),
  // Above mcp-woocommerce's own WOO_TIMEOUT_MS (10000), so a slow store comes back as that server's
  // clean isError instead of a gateway timeout. Enforced here too, not only by the chart schema.
  UPSTREAM_CALL_TIMEOUT_MS: intRange(20000, 11000, 120000),
  TRUST_PROXY: intRange(0, 0, 5),
});

/** A health check must finish before the next one is due. */
function healthTimeoutBelowInterval(v: { UPSTREAM_HEALTH_TIMEOUT_MS: number; UPSTREAM_HEALTH_INTERVAL_MS: number }, ctx: z.RefinementCtx): void {
  if (v.UPSTREAM_HEALTH_TIMEOUT_MS >= v.UPSTREAM_HEALTH_INTERVAL_MS) {
    ctx.addIssue({ code: 'custom', path: ['UPSTREAM_HEALTH_TIMEOUT_MS'], message: 'must be less than UPSTREAM_HEALTH_INTERVAL_MS' });
  }
}

const appSchema = appFields.superRefine(healthTimeoutBelowInterval);

// Read by `pg` itself; required here so a misconfigured pod fails at startup with the variable named.
const pgSchema = z.object({
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().min(1).max(65535).default(5432),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
});

const envSchema = appFields.extend(pgSchema.shape).superRefine(healthTimeoutBelowInterval);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Parse once so every problem is reported together, then return only the app settings.
  loadEnv(envSchema, env);
  return loadEnv(appSchema, env);
}

/** The SSRF rules for upstream URLs, shared by the servers API and the upstream manager. */
export function ssrfOptionsOf(config: Config): SsrfOptions {
  return {
    allowedInternalHosts: config.SSRF_ALLOWED_INTERNAL_HOSTS,
    allowLoopback: config.SSRF_ALLOW_LOOPBACK,
    // The URL check's DNS lookup gets the same budget as a health check.
    lookupTimeoutMs: config.UPSTREAM_HEALTH_TIMEOUT_MS,
  };
}
