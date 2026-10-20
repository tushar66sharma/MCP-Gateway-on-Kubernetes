import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** Retry only what a retry can fix: the gateway unreachable or a 5xx. Never a 4xx (it would fail again). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) return error.code === 'NETWORK' || error.status >= 500;
  return false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 10_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

/** The app-wide client. Tests create their own. */
export const queryClient = createQueryClient();
