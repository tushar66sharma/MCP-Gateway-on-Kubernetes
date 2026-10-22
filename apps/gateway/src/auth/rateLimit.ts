interface Window {
  count: number;
  resetAt: number;
}

export interface LimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * In-memory fixed-window limiter (spec §6.7: login 10 per minute per IP+email; chat; /mcp auth failures
 * per IP). `hit` counts, allowed or not; `check` only reads. Expired windows are swept at most once per
 * window length. Memory is capped at `maxKeys` (default 10,000): when a new key arrives at the cap, expired
 * windows are swept first, then the oldest inserted key is evicted (Map insertion order).
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly clock: () => Date;
  private readonly maxKeys: number;
  private lastSweep = 0;

  constructor(o: { max: number; windowMs: number; clock: () => Date; maxKeys?: number }) {
    this.max = o.max;
    this.windowMs = o.windowMs;
    this.clock = o.clock;
    this.maxKeys = o.maxKeys ?? 10_000;
  }

  /** Live keys (expired windows not yet swept are included). For tests. */
  get size(): number {
    return this.windows.size;
  }

  hit(key: string): LimitResult {
    const now = this.clock().getTime();
    this.sweep(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.delete(key);
      if (this.windows.size >= this.maxKeys) this.makeRoom(now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    if (w.count <= this.max) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: this.retryAfter(w, now) };
  }

  /** Whether the next `hit` would be allowed. Does not count and does not create a key. */
  check(key: string): LimitResult {
    const now = this.clock().getTime();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now || w.count < this.max) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: this.retryAfter(w, now) };
  }

  private retryAfter(w: Window, now: number): number {
    return Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }

  private makeRoom(now: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }
}
