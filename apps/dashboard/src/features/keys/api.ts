import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

/** The gateway's `KeyView`: the prefix is for recognising a key, never enough to use it. */
export interface KeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The only response that carries a plaintext key. Callers keep `plaintext` in component state only. */
export interface CreatedKey {
  key: KeyView;
  plaintext: string;
}

export const keysKey = ['keys'] as const;

export function useKeys() {
  return useQuery({
    queryKey: keysKey,
    queryFn: ({ signal }) => apiFetch<KeyView[]>('/api/keys', { signal }),
  });
}

/*
 * Creation is a plain function, not `useMutation`: its result holds the plaintext key, and the mutation
 * cache would keep that in memory as `data`.
 */
export const createKey = (name: string) => apiFetch<CreatedKey>('/api/keys', { method: 'POST', body: { name } });
export const revokeKey = (id: string) => apiFetch<void>(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });

export function useInvalidateKeys(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keysKey });
}

/** Where MCP clients connect: this origin's `/mcp`. */
export function mcpUrl(): string {
  return `${window.location.origin}/mcp`;
}
