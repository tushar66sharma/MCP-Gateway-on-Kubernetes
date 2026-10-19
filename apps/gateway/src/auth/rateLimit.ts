interface Window {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window limiter for login attempts (spec §6.7: 10 per minute per IP+email).
 * Every hit counts, allowed or not. Expired windows are swept at most once per window length,
 * so memory stays bounded by the keys seen in the last window.
 */
export class LoginRateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly clock: () => Date;
  private lastSweep = 0;

  constructor(o: { max: number; windowMs: number; clock: () => Date }) {
    this.max = o.max;
    this.windowMs = o.windowMs;
    this.clock = o.clock;
  }

  hit(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = this.clock().getTime();
    this.sweep(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    if (w.count <= this.max) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
