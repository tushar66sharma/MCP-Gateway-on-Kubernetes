import { describe, expect, it } from 'vitest';
import { EnvValidationError } from '@urumi/shared';
import { loadConfig } from '../src/config.js';
import { PG_POOL_OPTIONS } from '../src/db/client.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

function validEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PUBLIC_APP_URL: 'http://app.localhost',
    GATEWAY_ENCRYPTION_KEY: KEY,
    GATEWAY_INTERNAL_TOKEN_SECRET: 'x'.repeat(32),
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'correct horse battery',
    PGHOST: 'localhost',
    PGDATABASE: 'gateway',
    PGUSER: 'gateway',
    PGPASSWORD: 'pw-not-in-errors',
    ...extra,
  };
}

function errorOf(env: NodeJS.ProcessEnv): EnvValidationError {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    return err as EnvValidationError;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('loads a valid env with defaults', () => {
    const c = loadConfig(validEnv());
    expect(c.PORT).toBe(3000);
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.MCP_ALLOWED_HOSTS).toEqual(['localhost', '127.0.0.1']);
    expect(Buffer.isBuffer(c.GATEWAY_ENCRYPTION_KEY)).toBe(true);
    expect(c.GATEWAY_ENCRYPTION_KEY.length).toBe(32);
    expect(c.SEED_SERVERS).toEqual([]);
    expect(c.SSRF_ALLOWED_INTERNAL_HOSTS).toEqual(['*.mcp.svc.cluster.local']);
    expect(c.SSRF_ALLOW_LOOPBACK).toBe(false);
    expect(c.UPSTREAM_HEALTH_INTERVAL_MS).toBe(15000);
    expect(c.UPSTREAM_HEALTH_TIMEOUT_MS).toBe(5000);
    expect(c.UPSTREAM_CALL_TIMEOUT_MS).toBe(20000);
  });

  it('rejects an encryption key that is not 32 bytes, naming the variable but not the value', () => {
    const bad = Buffer.alloc(16, 9).toString('base64');
    const err = errorOf(validEnv({ GATEWAY_ENCRYPTION_KEY: bad }));
    expect(err.message).toContain('GATEWAY_ENCRYPTION_KEY');
    expect(err.message).not.toContain(bad);
  });

  it('names SEED_SERVERS when it is not JSON', () => {
    expect(errorOf(validEnv({ SEED_SERVERS: 'not json' })).message).toContain('SEED_SERVERS');
  });

  it('names SEED_SERVERS when a slug is invalid', () => {
    const seed = JSON.stringify([{ slug: 'Bad_Slug', name: 'X', url: 'http://x.mcp.svc.cluster.local/mcp', authType: 'none' }]);
    expect(errorOf(validEnv({ SEED_SERVERS: seed })).message).toContain('SEED_SERVERS');
  });

  it('requires a header name for header-auth seed servers, naming the entry and field', () => {
    const seed = JSON.stringify([
      { slug: 'notes', name: 'Notes', url: 'http://n.mcp.svc.cluster.local/mcp', authType: 'none' },
      { slug: 'utils', name: 'Utils', url: 'http://u.mcp.svc.cluster.local/mcp', authType: 'header', credentialEnv: 'SECRET_ENV_NAME' },
    ]);
    const msg = errorOf(validEnv({ SEED_SERVERS: seed })).message;
    expect(msg).toContain('SEED_SERVERS.1.authHeaderName');
    expect(msg).not.toContain('SECRET_ENV_NAME');
  });

  it('accepts a valid seed server', () => {
    const seed = [{ slug: 'notes', name: 'Notes', url: 'http://mcp-notes.mcp.svc.cluster.local:3002/mcp', authType: 'bearer', credentialEnv: 'NOTES_TOKEN' }];
    expect(loadConfig(validEnv({ SEED_SERVERS: JSON.stringify(seed) })).SEED_SERVERS).toEqual(seed);
  });

  it('rejects UPSTREAM_CALL_TIMEOUT_MS below 11000 (above the WooCommerce server timeout)', () => {
    for (const v of ['500', '10000', '10999']) expect(errorOf(validEnv({ UPSTREAM_CALL_TIMEOUT_MS: v })).message).toContain('UPSTREAM_CALL_TIMEOUT_MS');
    expect(loadConfig(validEnv({ UPSTREAM_CALL_TIMEOUT_MS: '11000' })).UPSTREAM_CALL_TIMEOUT_MS).toBe(11000);
  });

  it('requires UPSTREAM_HEALTH_TIMEOUT_MS below UPSTREAM_HEALTH_INTERVAL_MS', () => {
    for (const [timeout, interval] of [
      ['5000', '5000'],
      ['6000', '5000'],
      ['20000', '15000'],
    ]) {
      const msg = errorOf(validEnv({ UPSTREAM_HEALTH_TIMEOUT_MS: timeout!, UPSTREAM_HEALTH_INTERVAL_MS: interval! })).message;
      expect(msg).toContain('UPSTREAM_HEALTH_TIMEOUT_MS');
    }
    const ok = loadConfig(validEnv({ UPSTREAM_HEALTH_TIMEOUT_MS: '4999', UPSTREAM_HEALTH_INTERVAL_MS: '5000' }));
    expect([ok.UPSTREAM_HEALTH_TIMEOUT_MS, ok.UPSTREAM_HEALTH_INTERVAL_MS]).toEqual([4999, 5000]);
  });

  it('bounds the Postgres pool: connect 5 s, statement 10 s, idle 30 s', () => {
    expect(PG_POOL_OPTIONS).toEqual({ max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
  });

  it('requires the Postgres variables, naming them only', () => {
    const env = validEnv();
    delete env.PGPASSWORD;
    const err = errorOf(env);
    expect(err.message).toContain('PGPASSWORD');
    expect(err.message).not.toContain('pw-not-in-errors');
  });

  it('reads TRUST_PROXY as 0..5 proxy hops, default 0', () => {
    expect(loadConfig(validEnv()).TRUST_PROXY).toBe(0);
    expect(loadConfig(validEnv({ TRUST_PROXY: '1' })).TRUST_PROXY).toBe(1);
    for (const bad of ['-1', '6', '1.5', 'true']) {
      expect(errorOf(validEnv({ TRUST_PROXY: bad })).message).toContain('TRUST_PROXY');
    }
  });

  it('validates SSRF_ALLOWED_INTERNAL_HOSTS entries, naming the variable but not the value', () => {
    const ok = '*.mcp.svc.cluster.local,api.internal.example,*.svc.local,10.0.0.5';
    expect(loadConfig(validEnv({ SSRF_ALLOWED_INTERNAL_HOSTS: ok })).SSRF_ALLOWED_INTERNAL_HOSTS).toEqual(ok.split(','));
    for (const bad of ['*.', '*', '*.local', 'localhost', '*.*.example', 'bad_host.example', '*.mcp..local']) {
      const err = errorOf(validEnv({ SSRF_ALLOWED_INTERNAL_HOSTS: `*.mcp.svc.cluster.local,${bad}` }));
      expect(err.message, bad).toContain('SSRF_ALLOWED_INTERNAL_HOSTS.1');
      expect(err.message).not.toContain(bad);
    }
  });

  it('trims and lowercases the bootstrap email', () => {
    expect(loadConfig(validEnv({ BOOTSTRAP_ADMIN_EMAIL: ' Admin@Example.COM ' })).BOOTSTRAP_ADMIN_EMAIL).toBe('admin@example.com');
  });
});
