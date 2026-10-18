import { pino } from 'pino';

export type Logger = pino.Logger;

const CENSOR = '[REDACTED]';

export const redactPaths: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.authorization',
  '*.password',
  '*.token',
  '*.secret',
  '*.consumerSecret',
  '*.consumerKey',
  '*.credential',
  'authorization',
  'password',
  'token',
  'secret',
  'consumerSecret',
  'consumerKey',
  'credential',
];

// pino paths cannot express "any key ending in key/secret", so top-level keys are checked here.
const SENSITIVE_SUFFIX = /(key|secret)$/i;

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info', destination?: pino.DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    name,
    level,
    redact: { paths: redactPaths, censor: CENSOR },
    formatters: {
      log(obj) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          out[k] = SENSITIVE_SUFFIX.test(k) ? CENSOR : v;
        }
        return out;
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
