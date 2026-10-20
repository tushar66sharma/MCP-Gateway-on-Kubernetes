import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import type { ServerStatus } from '../../components/ui/StatusBadge';
import type { CreateServerBody, PatchServerBody } from './serverForm';

/** The gateway's `ServerView`: never contains the credential, only whether one is stored. */
export interface ServerView {
  id: string;
  slug: string;
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'header';
  authHeaderName: string | null;
  hasCredential: boolean;
  enabled: boolean;
  status: ServerStatus;
  lastError: string | null;
  checkedAt: string | null;
  toolCount: number;
  tools: { name: string; description: string }[];
  skippedTools: string[];
}

/** Server health changes without anyone clicking, so the views poll every 10 s (spec §7). */
export const SERVER_REFETCH_MS = 10_000;

export const serversKey = ['servers'] as const;

export function useServers() {
  return useQuery({
    queryKey: serversKey,
    queryFn: ({ signal }) => apiFetch<ServerView[]>('/api/servers', { signal }),
    refetchInterval: SERVER_REFETCH_MS,
  });
}

export function useServer(id: string | undefined) {
  return useQuery({
    queryKey: [...serversKey, id],
    queryFn: ({ signal }) => apiFetch<ServerView>(`/api/servers/${encodeURIComponent(id ?? '')}`, { signal }),
    enabled: id !== undefined,
    refetchInterval: SERVER_REFETCH_MS,
  });
}

/*
 * Mutations are plain functions, not `useMutation`: a create or edit body can hold a credential, and
 * the mutation cache would keep it in memory as `variables`. Callers invalidate with `useRefreshServers`.
 */
export const createServer = (body: CreateServerBody) => apiFetch<ServerView>('/api/servers', { method: 'POST', body });
export const patchServer = (id: string, body: PatchServerBody | { enabled: boolean }) =>
  apiFetch<ServerView>(`/api/servers/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deleteServer = (id: string) => apiFetch<void>(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const refreshServer = (id: string) => apiFetch<ServerView>(`/api/servers/${encodeURIComponent(id)}/refresh`, { method: 'POST' });

/** Marks every server query stale so the list and detail pages reload after a change. */
export function useInvalidateServers(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: serversKey });
}

/** Servers the platform seeds on first start: deleting one is permanent until it is re-added by hand. */
export const SEEDED_SLUGS: readonly string[] = ['woo', 'notes', 'utils'];
