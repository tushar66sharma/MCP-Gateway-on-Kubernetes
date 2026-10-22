import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../../src/auth/rateLimit.js';

describe('FixedWindowLimiter', () => {
  it('blocks the 11th hit within 60 s, then allows again after the window', () => {
    let t = Date.parse('2026-10-19T10:00:00Z');
    const limiter = new FixedWindowLimiter({ max: 10, windowMs: 60_000, clock: () => new Date(t) });
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

  it('check does not count', () => {
    const t = Date.parse('2026-10-19T10:00:00Z');
    const limiter = new FixedWindowLimiter({ max: 2, windowMs: 60_000, clock: () => new Date(t) });
    for (let i = 0; i < 50; i++) expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.size).toBe(0);
    limiter.hit('k');
    expect(limiter.check('k').allowed).toBe(true);
    limiter.hit('k');
    const full = limiter.check('k');
    expect(full.allowed).toBe(false);
    expect(full.retryAfterSec).toBeGreaterThan(0);
    // Still only two counted hits: the next hit is the third.
    expect(limiter.hit('k').allowed).toBe(false);
  });

  it('evicts the oldest key at maxKeys', () => {
    const t = Date.parse('2026-10-19T10:00:00Z');
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 60_000, clock: () => new Date(t), maxKeys: 3 });
    for (const k of ['a', 'b', 'c']) limiter.hit(k);
    expect(limiter.hit('a').allowed).toBe(false);
    limiter.hit('d');
    expect(limiter.size).toBe(3);
    // 'a' was the oldest inserted, so it starts a fresh window.
    expect(limiter.hit('a').allowed).toBe(true);
    // ...which evicted 'b' in turn.
    expect(limiter.size).toBe(3);
    expect(limiter.hit('b').allowed).toBe(true);
  });

  it('sweeps expired windows before evicting', () => {
    let t = Date.parse('2026-10-19T10:00:00Z');
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 60_000, clock: () => new Date(t), maxKeys: 3 });
    limiter.hit('old1');
    limiter.hit('old2');
    t += 30_000;
    limiter.hit('live'); // expires at +90 s
    t += 40_000; // old1 and old2 expired, live has not
    limiter.hit('new');
    expect(limiter.size).toBe(2);
    // 'live' was kept: it is still blocked.
    expect(limiter.hit('live').allowed).toBe(false);
  });
});
