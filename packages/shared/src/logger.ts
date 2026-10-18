import { pino } from 'pino';

export type Logger = pino.Logger;

const CENSOR = '[REDACTED]';

export const redactPaths: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-utilities-key"]',
  '*.headers["x-utilities-key"]',
  '*.authorization',
  '*.password',
  '*.token',
  '*.secret',
  '*.consumerSecret',
  '*.consumerKey',
  '*.apiKey',
  '*.credential',
  'authorization',
  'password',
  'token',
  'secret',
  'consumerSecret',
  'consumerKey',
  'apiKey',
  'credential',
];

// pino paths cannot express "any key ending in key/secret", so the log formatter also censors such keys,
// at any depth inside plain objects and arrays (e.g. wooConsumerKey, user.apiKey, headers["x-api-key"]).
const SENSITIVE_SUFFIX = /(key|secret)$/i;
const MAX_DEPTH = 10;

// Returns a censored copy; the caller's object is never mutated. Cycles and data nested deeper than
// MAX_DEPTH are replaced by markers, because handing the original back to pino would leak their keys.
function censorSuffixKeys(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  const proto: unknown = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  // Only plain data is copied; Errors, Buffers, Dates etc. are left to pino's serializers.
  if (!isArray && proto !== Object.prototype && proto !== null) return value;
  if (ancestors.has(value)) return '[Circular]';
  if (depth > MAX_DEPTH) return '[Truncated]';
  ancestors.add(value);
  let out: unknown;
  if (isArray) {
    out = (value as unknown[]).map((v) => censorSuffixKeys(v, depth + 1, ancestors));
  } else {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      copy[k] = SENSITIVE_SUFFIX.test(k) ? CENSOR : censorSuffixKeys(v, depth + 1, ancestors);
    }
    out = copy;
  }
  ancestors.delete(value);
  return out;
}

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info', destination?: pino.DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    name,
    level,
    redact: { paths: redactPaths, censor: CENSOR },
    formatters: {
      log(obj) {
        return censorSuffixKeys(obj, 0, new Set()) as Record<string, unknown>;
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
