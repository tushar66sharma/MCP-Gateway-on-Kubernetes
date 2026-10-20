import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** One row of `GET /api/audit` (the gateway's `AuditView`). */
export interface AuditItem {
  id: string;
  event: string;
  source: string;
  userId: string | null;
  userEmail: string | null;
  serverSlug: string | null;
  toolName: string | null;
  startedAt: string;
  durationMs: number;
  outcome: string;
  errorMessage: string | null;
}

export interface AuditPage {
  items: AuditItem[];
  nextCursor: string | null;
}

export const OUTCOMES = ['success', 'error', 'timeout', 'denied', 'unauthorized'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The filter bar's values; an empty string means "not filtered". `from`/`to` are `datetime-local` values. */
export interface AuditFilterValues {
  userId: string;
  serverSlug: string;
  toolName: string;
  outcome: '' | Outcome;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: AuditFilterValues = { userId: '', serverSlug: '', toolName: '', outcome: '', from: '', to: '' };

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as Array<keyof AuditFilterValues>;

export function parseFilters(params: URLSearchParams): AuditFilterValues {
  const outcome = params.get('outcome') ?? '';
  return {
    userId: params.get('userId') ?? '',
    serverSlug: params.get('serverSlug') ?? '',
    toolName: (params.get('toolName') ?? '').trim(),
    outcome: (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as Outcome) : '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
}

export function serializeFilters(values: AuditFilterValues): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (values[key] !== '') params.set(key, values[key]);
  return params;
}

export function hasFilters(values: AuditFilterValues): boolean {
  return FILTER_KEYS.some((key) => values[key] !== '');
}

/** A `datetime-local` value is the viewer's local time; the API wants an ISO instant. Unparseable → dropped. */
function toIso(local: string): string | undefined {
  if (local === '') return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export interface ToolFilterSplit {
  serverSlug: string;
  toolName: string;
  /** Set when the input named another server than the one already chosen: that server filter was kept. */
  keptServer?: string;
}

/**
 * The table shows prefixed names (`utils__calculate`) while the API filters on the bare tool name, so a
 * prefixed input is split on its first `__` into the server and the tool. A server filter that is already
 * set to a different slug wins, and only the tool part is used.
 */
export function splitToolFilter(input: string, serverSlug: string): ToolFilterSplit {
  const at = input.indexOf('__');
  if (at <= 0 || at + 2 >= input.length) return { serverSlug, toolName: input };
  const slug = input.slice(0, at);
  const toolName = input.slice(at + 2);
  if (serverSlug !== '' && serverSlug !== slug) return { serverSlug, toolName, keptServer: serverSlug };
  return { serverSlug: slug, toolName };
}

export const AUDIT_PAGE_SIZE = 50;

export function auditPath(values: AuditFilterValues, cursor?: string, limit = AUDIT_PAGE_SIZE): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (values.userId) params.set('userId', values.userId);
  if (values.serverSlug) params.set('serverSlug', values.serverSlug);
  if (values.toolName) params.set('toolName', values.toolName);
  if (values.outcome) params.set('outcome', values.outcome);
  const from = toIso(values.from);
  const to = toIso(values.to);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (cursor) params.set('cursor', cursor);
  return `/api/audit?${params.toString()}`;
}

/** The newest rows first; "Load more" follows `nextCursor`. */
export function useAuditLog(values: AuditFilterValues) {
  return useInfiniteQuery({
    queryKey: ['audit', 'log', values],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => apiFetch<AuditPage>(auditPath(values, pageParam), { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
