import {
  defineTool as sharedDefineTool, ok, PERIODS, registerTools, resolvePeriod, toolError,
  type SdkMcpServer, type ToolDefinition as SharedToolDefinition,
} from '@urumi/shared';
import { z } from 'zod';
import { CalcError, evaluate } from './calc.js';
import { validTimeZone } from './config.js';

export interface UtilitiesDeps {
  defaultTimeZone: string;
  now: () => Date;
}

type ToolDefinition<S extends z.ZodObject = z.ZodObject> = SharedToolDefinition<UtilitiesDeps, S>;

function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition {
  return sharedDefineTool<UtilitiesDeps, S>(def);
}

const timezoneArg = z.string().min(1).max(64).optional().describe('IANA time zone, e.g. Asia/Kolkata');

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Local wall-clock time and UTC offset of an instant in a zone. */
function localTime(instant: Date, timeZone: string): { local: string; offset: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const [y, mo, d, h, mi, s] = [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')] as const;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMin = Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return {
    local: `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`,
    offset: `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  };
}

const dateRange = defineTool({
  name: 'date_range',
  title: 'Date range',
  description: "Start and end (UTC ISO) of today, yesterday or the last 7 days in a time zone (default: the store's).",
  inputSchema: z.object({ preset: z.enum(PERIODS), timezone: timezoneArg }),
  handler: ({ preset, timezone }, { defaultTimeZone, now }) => {
    const tz = timezone ?? defaultTimeZone;
    if (!validTimeZone(tz)) return Promise.resolve(toolError(`Unknown time zone: ${tz}`));
    const { after, before } = resolvePeriod(preset, tz, now());
    return Promise.resolve(ok(`${preset} in ${tz}: ${after} to ${before}`, { preset, timezone: tz, after, before }));
  },
});

const currentTime = defineTool({
  name: 'current_time',
  title: 'Current time',
  description: "Current time in UTC and in a time zone (default: the store's).",
  inputSchema: z.object({ timezone: timezoneArg }),
  handler: ({ timezone }, { defaultTimeZone, now }) => {
    const tz = timezone ?? defaultTimeZone;
    if (!validTimeZone(tz)) return Promise.resolve(toolError(`Unknown time zone: ${tz}`));
    const instant = now();
    const { local, offset } = localTime(instant, tz);
    const utc = instant.toISOString();
    return Promise.resolve(ok(`${local} ${offset} in ${tz}`, { utc, timezone: tz, local, offset }));
  },
});

const calculate = defineTool({
  name: 'calculate',
  title: 'Calculate',
  description: 'Evaluate arithmetic: + - * / % ^ and parentheses, decimals allowed.',
  inputSchema: z.object({ expression: z.string().min(1).max(200) }),
  handler: ({ expression }) => {
    try {
      const result = evaluate(expression);
      return Promise.resolve(ok(`${expression} = ${result}`, { expression, result }));
    } catch (err) {
      if (err instanceof CalcError) return Promise.resolve(toolError(`Cannot evaluate: ${err.message}`));
      throw err;
    }
  },
});

const ping = defineTool({
  name: 'ping',
  title: 'Ping',
  description: 'Health check: returns ok and the server time.',
  inputSchema: z.object({}),
  handler: (_args, { now }) => {
    const time = now().toISOString();
    return Promise.resolve(ok(`ok at ${time}`, { ok: true, server: 'mcp-utilities', time }));
  },
});

export const utilitiesTools: readonly ToolDefinition[] = [dateRange, currentTime, calculate, ping];

export function registerUtilitiesTools(server: SdkMcpServer, deps: UtilitiesDeps): void {
  registerTools(server, utilitiesTools, deps);
}
