import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import type { CreatedKey, KeyView } from '../keys/api';

export type Role = 'admin' | 'member';

export interface UserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

/** A pending invite. The list has no created time; it is ordered by expiry. */
export interface InviteView {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  expired: boolean;
}

export interface InvitePreview {
  email: string;
  role: Role;
  expiresAt: string;
}

export const usersKey = ['users'] as const;
export const invitesKey = ['invites'] as const;
export const userKeysKey = (userId: string) => ['users', userId, 'keys'] as const;

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: ({ signal }) => apiFetch<UserView[]>('/api/users', { signal }) });
}

export function useInvites() {
  return useQuery({ queryKey: invitesKey, queryFn: ({ signal }) => apiFetch<InviteView[]>('/api/invites', { signal }) });
}

export function useUserKeys(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: userKeysKey(userId),
    queryFn: ({ signal }) => apiFetch<KeyView[]>(`/api/users/${encodeURIComponent(userId)}/keys`, { signal }),
    enabled,
  });
}

/*
 * Mutations are plain functions so the new key's plaintext and the invite link (both bearer secrets)
 * never enter the mutation cache.
 */
export const patchUser = (id: string, body: { role: Role } | { disabled: boolean }) =>
  apiFetch<{ user: UserView }>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const createUserKey = (userId: string, name: string) =>
  apiFetch<CreatedKey>(`/api/users/${encodeURIComponent(userId)}/keys`, { method: 'POST', body: { name } });
export const revokeUserKey = (userId: string, keyId: string) =>
  apiFetch<void>(`/api/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
export const createInvite = (body: { email: string; role: Role }) =>
  apiFetch<{ invite: InviteView; link: string }>('/api/invites', { method: 'POST', body });
export const cancelInvite = (id: string) => apiFetch<void>(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const fetchInvitePreview = (token: string, signal?: AbortSignal) =>
  apiFetch<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`, signal ? { signal } : {});
export const acceptInvite = (token: string, body: { name: string; password: string }) =>
  apiFetch<{ user: { id: string; email: string; name: string; role: Role } }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    body,
  });

export function useInvalidateTeam() {
  const queryClient = useQueryClient();
  return {
    users: () => queryClient.invalidateQueries({ queryKey: usersKey, exact: true }),
    invites: () => queryClient.invalidateQueries({ queryKey: invitesKey }),
    userKeys: (userId: string) => queryClient.invalidateQueries({ queryKey: userKeysKey(userId) }),
  };
}
