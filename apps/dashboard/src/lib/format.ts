/** Display formatting shared by every page. All functions accept the API's ISO strings and tolerate null. */

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const integer = new Intl.NumberFormat();

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value);
  return d ? dateTime.format(d) : fallback;
}

export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value);
  return d ? dateOnly.format(d) : fallback;
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "3 minutes ago", "in 2 days"; under 10 seconds is "just now". */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date(), fallback = 'never'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  if (Math.abs(diffSec) < 10) return 'just now';
  for (const [unit, size] of UNITS) {
    if (Math.abs(diffSec) >= size || unit === 'second') return relative.format(Math.round(diffSec / size), unit);
  }
  return fallback;
}

export function formatNumber(value: number): string {
  return integer.format(value);
}

/** 850 → "850 ms", 1530 → "1.5 s", 61000 → "1 min 1 s". */
export function formatDuration(ms: number | null | undefined, fallback = '—'): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** "1 tool" / "3 tools". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}
