import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { csrf, startHarness, type Harness } from '../helpers/harness.js';

/** Login attempts for one email from one claimed client address; returns the HTTP statuses. */
async function attempts(h: Harness, forwardedFor: string, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await csrf(request(h.baseUrl).post('/api/auth/login'))
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: 'victim@example.com', password: 'wrong-password-1' });
    out.push(res.status);
  }
  return out;
}

describe('TRUST_PROXY and the login rate-limit key', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('with TRUST_PROXY=1, clients behind the proxy are limited independently', async () => {
    h = await startHarness({ seedAdmin: false, env: { TRUST_PROXY: '1' } });
    const a = await attempts(h, '203.0.113.10', 11);
    expect(a.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(a[10]).toBe(429);
    expect(await attempts(h, '203.0.113.20', 1)).toEqual([401]);
  });

  it('with TRUST_PROXY=0 (default), X-Forwarded-For is ignored', async () => {
    h = await startHarness({ seedAdmin: false });
    expect(h.deps.config.TRUST_PROXY).toBe(0);
    await attempts(h, '203.0.113.10', 10);
    expect(await attempts(h, '203.0.113.20', 1)).toEqual([429]);
  });
});
