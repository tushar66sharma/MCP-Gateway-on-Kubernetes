import { describe, expect, it } from 'vitest';
import type { LookupAddress } from 'node:dns';
import { assertSafeUpstreamUrl, createSafeLookup, SsrfError, type SsrfOptions } from '../../src/security/ssrf.js';

const allowed = ['*.mcp.svc.cluster.local'];
const opts = (lookupTo?: string[] | Error, extra: Partial<SsrfOptions> = {}): SsrfOptions => ({
  allowedInternalHosts: allowed,
  lookup: async () => {
    if (lookupTo instanceof Error) throw lookupTo;
    return lookupTo ?? [];
  },
  ...extra,
});

async function reason(url: string, o: SsrfOptions): Promise<string> {
  try {
    await assertSafeUpstreamUrl(url, o);
  } catch (e) {
    if (e instanceof SsrfError) return e.reason;
    throw e;
  }
  return 'allowed';
}

describe('assertSafeUpstreamUrl rejects', () => {
  it.each([
    ['http://169.254.169.254/', undefined, 'link_local'],
    ['http://localhost/', ['127.0.0.1'], 'loopback'],
    ['http://[::1]/', undefined, 'loopback'],
    ['http://[::ffff:127.0.0.1]/', undefined, 'loopback'],
    ['http://2130706433/', undefined, 'loopback'],
    ['file:///etc/passwd', undefined, 'scheme'],
    ['http://u:p@example.com/', ['93.184.216.34'], 'credentials_in_url'],
    ['http://10.0.0.5/', undefined, 'private'],
    ['http://evil.example/', ['127.0.0.1'], 'loopback'],
    ['http://x.mcp.svc.cluster.local/', ['169.254.169.254'], 'link_local'],
    ['http://0.0.0.0/', undefined, 'unspecified'],
    ['http://[::]/', undefined, 'unspecified'],
    ['http://[fe80::1]/', undefined, 'link_local'],
    ['http://[fd00::1]/', undefined, 'private'],
    ['http://100.64.1.1/', undefined, 'private'],
    ['http://172.31.0.1/', undefined, 'private'],
    ['http://192.168.1.1/', undefined, 'private'],
    ['http://evil.example/', ['93.184.216.34', '10.0.0.1'], 'private'],
    ['not a url', undefined, 'invalid_url'],
    ['http://other.example/', ['10.43.0.10'], 'private'],
    ['http://mcp.svc.cluster.local/', ['10.43.0.10'], 'private'],
    ['http://[::7f00:1]/', undefined, 'loopback'],
    ['http://[64:ff9b::a9fe:a9fe]/', undefined, 'link_local'],
    ['http://[::ffff:0:a9fe:a9fe]/', undefined, 'link_local'],
    ['http://[::a00:1]/', undefined, 'private'],
  ])('%s -> %s', async (url, lookup, expected) => {
    expect(await reason(url, opts(lookup))).toBe(expected);
  });

  it('dns_failed when lookup throws', async () => {
    expect(await reason('http://nope.example/', opts(new Error('ENOTFOUND')))).toBe('dns_failed');
  });

  it('does not echo credentials', async () => {
    await expect(assertSafeUpstreamUrl('http://user:sekret@example.com/', opts())).rejects.not.toThrow(/sekret/);
  });
});

describe('assertSafeUpstreamUrl allows', () => {
  it('allowlisted internal host', async () => {
    const u = await assertSafeUpstreamUrl('http://mcp-notes.mcp.svc.cluster.local:3002/mcp', opts(['10.43.0.10']));
    expect(u.port).toBe('3002');
  });
  it('public ip', async () => {
    expect(await reason('http://93.184.216.34/', opts())).toBe('allowed');
  });
  it('loopback when allowed', async () => {
    expect(await reason('http://127.0.0.1:4000/mcp', opts(undefined, { allowLoopback: true }))).toBe('allowed');
  });
});

describe('SsrfError messages', () => {
  it.each([
    ['http://0.0.0.0/', 'resolves to an unspecified address'],
    ['http://169.254.169.254/', 'resolves to a link-local address'],
    ['http://[::1]/', 'resolves to a loopback address'],
    ['http://10.0.0.5/', 'resolves to a private address'],
  ])('%s -> %s', async (url, text) => {
    await expect(assertSafeUpstreamUrl(url, opts())).rejects.toThrow(text);
  });
});

type LookupResult = { err: NodeJS.ErrnoException | null; address: string | LookupAddress[] | undefined; family?: number };

function runLookup(o: SsrfOptions, all: boolean): Promise<LookupResult> {
  return new Promise((resolve) => {
    createSafeLookup(o)('upstream.example', { all }, (err, address, family) => resolve({ err, address, family }));
  });
}

describe('createSafeLookup', () => {
  it('rejects a link-local address through the callback', async () => {
    const r = await runLookup(opts(['169.254.169.254']), false);
    expect(r.err).toBeInstanceOf(SsrfError);
    expect((r.err as SsrfError).reason).toBe('link_local');
  });

  it('rejects when any address is blocked (all: true)', async () => {
    const r = await runLookup(opts(['93.184.216.34', '127.0.0.1']), true);
    expect(r.err).toBeInstanceOf(SsrfError);
    expect((r.err as SsrfError).reason).toBe('loopback');
  });

  it('lets loopback through when allowLoopback is set', async () => {
    const r = await runLookup(opts(['127.0.0.1'], { allowLoopback: true }), false);
    expect(r.err).toBeNull();
    expect(r.address).toBe('127.0.0.1');
    expect(r.family).toBe(4);
  });

  it('returns every address with families for all: true', async () => {
    const r = await runLookup(opts(['93.184.216.34', '2606:2800:220:1::1']), true);
    expect(r.err).toBeNull();
    expect(r.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });

  it('applies the hostname allowlist to private addresses', async () => {
    const allowedHost = await new Promise<LookupResult>((resolve) => {
      createSafeLookup(opts(['10.43.0.10']))('mcp-notes.mcp.svc.cluster.local', { all: false }, (err, address) =>
        resolve({ err, address }),
      );
    });
    expect(allowedHost.err).toBeNull();
    const other = await runLookup(opts(['10.43.0.10']), false);
    expect((other.err as SsrfError).reason).toBe('private');
  });
});
