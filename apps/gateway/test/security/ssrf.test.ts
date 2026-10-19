import { describe, expect, it } from 'vitest';
import { assertSafeUpstreamUrl, SsrfError, type SsrfOptions } from '../../src/security/ssrf.js';

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
