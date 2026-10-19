import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../../src/auth/rateLimit.js';

describe('LoginRateLimiter', () => {
  it('blocks the 11th hit within 60 s, then allows again after the window', () => {
    let t = Date.parse('2026-10-19T10:00:00Z');
    const limiter = new LoginRateLimiter({ max: 10, windowMs: 60_000, clock: () => new Date(t) });
    for (let i = 0; i < 10; i++) {
      expect(limiter.hit('1.2.3.4|a@example.com').allowed).toBe(true);
      t += 1000;
    }
    const blocked = limiter.hit('1.2.3.4|a@example.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);

    // Other keys are independent.
    expect(limiter.hit('1.2.3.4|b@example.com').allowed).toBe(true);

    t += 60_000;
    expect(limiter.hit('1.2.3.4|a@example.com')).toEqual({ allowed: true, retryAfterSec: 0 });
  });
});
