import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintInternalToken } from '../../src/auth/internalToken.js';
import { connectLoopback } from '../../src/chat/mcpLoopback.js';
import { startFakeUpstream, type FakeUpstream } from '../helpers/fakeUpstream.js';
import { INTERNAL_SECRET, startHarness, type Harness } from '../helpers/harness.js';
import { randomUUID } from 'node:crypto';
import type { UpstreamAuth } from '@urumi/shared';
import type { UpstreamRecord } from '../../src/upstreams/connection.js';

const AUTH: UpstreamAuth = { kind: 'bearer', token: 'utils-upstream-token-1234' };

describe('connectLoopback', () => {
  let utils: FakeUpstream;
  let h: Harness;

  beforeAll(async () => {
    utils = await startFakeUpstream({ name: 'utils', tools: ['calculate'], auth: AUTH });
    const upstreams: UpstreamRecord[] = [{ id: randomUUID(), slug: 'utils', name: 'Utilities', url: utils.url, enabled: true, auth: AUTH }];
    h = await startHarness({ upstreams });
  });
  afterAll(async () => {
    await h?.close();
    await utils?.stop();
  });

  it('connectLoopback rejects immediately on an aborted signal', async () => {
    const mint = vi.fn(() => Promise.resolve('never-used'));
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    await expect(connectLoopback('http://127.0.0.1:9/mcp', mint, ac.signal)).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(500);
    expect(mint).not.toHaveBeenCalled();
  });

  it('an abort during connect rejects the connect', async () => {
    const ac = new AbortController();
    // The mint never resolves, so the connect can only end through the signal.
    const mint = vi.fn(() => new Promise<string>(() => {}));
    const pending = connectLoopback(`${h.baseUrl}/mcp`, mint, ac.signal);
    await vi.waitFor(() => expect(mint).toHaveBeenCalled());
    ac.abort();
    await expect(pending).rejects.toBeDefined();
  });

  it('mints a fresh internal token for every HTTP request of a turn', async () => {
    const user = await h.createUser({ email: 'loop@example.com', role: 'member' });
    const tokens: string[] = [];
    const mint = async () => {
      const t = await mintInternalToken(user.id, INTERNAL_SECRET, undefined, h.deps.clock());
      tokens.push(t);
      return t;
    };
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(h.baseUrl)) seen.push(url);
      return realFetch(input, init);
    });
    try {
      const mcp = await connectLoopback(`${h.baseUrl}/mcp`, mint);
      await mcp.listTools();
      const ctl = new AbortController();
      await mcp.callTool('utils__calculate', { expression: '1+1' }, ctl.signal);
      await mcp.callTool('utils__calculate', { expression: '2+2' }, ctl.signal);
      await mcp.close();
    } finally {
      spy.mockRestore();
    }
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(tokens.length).toBeGreaterThanOrEqual(seen.length);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
