import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { buttonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';
import { ApiError, apiFetch, onUnauthenticated } from './api';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signedIn'; me: Me }
  | { status: 'signedOut' }
  | { status: 'error'; error: unknown };

interface AuthContextValue {
  state: AuthState;
  setMe: (me: Me | null) => void;
  reload: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('Auth hooks must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Holds the signed-in user. It asks `GET /api/auth/me` once on mount; afterwards any
 * `401 UNAUTHENTICATED` anywhere (an expired session) signs the user out and drops every cached query,
 * and `RequireAuth` then sends them to `/login?next=<where they were>`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ user: Me }>('/api/auth/me', { signal: controller.signal }).then(
      ({ user }) => setState({ status: 'signedIn', me: user }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) setState({ status: 'signedOut' });
        else setState({ status: 'error', error: err });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(
    () =>
      onUnauthenticated(() => {
        queryClient.clear();
        setState({ status: 'signedOut' });
      }),
    [queryClient],
  );

  const setMe = useCallback((me: Me | null) => setState(me ? { status: 'signedIn', me } : { status: 'signedOut' }), []);
  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ state, setMe, reload }), [state, setMe, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useMe(): { me: Me | null; loading: boolean } {
  const { state } = useAuthContext();
  return { me: state.status === 'signedIn' ? state.me : null, loading: state.status === 'loading' };
}

export function useLogin(): (email: string, password: string) => Promise<Me> {
  const { setMe } = useAuthContext();
  const queryClient = useQueryClient();
  return useCallback(
    async (email, password) => {
      const { user } = await apiFetch<{ user: Me }>('/api/auth/login', { method: 'POST', body: { email, password } });
      // Nothing cached for a previous user may leak into this session.
      queryClient.clear();
      setMe(user);
      return user;
    },
    [queryClient, setMe],
  );
}

/**
 * Adopts a session the API just started (the cookie is already set, e.g. by accepting an invite): drops
 * everything cached for the previous user and makes `me` the new user.
 */
export function useStartSession(): (me: Me) => void {
  const { setMe } = useAuthContext();
  const queryClient = useQueryClient();
  return useCallback(
    (me) => {
      queryClient.clear();
      setMe(me);
    },
    [queryClient, setMe],
  );
}

/** Logs out. A 401 means the session was already gone, which is the outcome we wanted anyway. */
export function useLogout(): () => Promise<void> {
  const { setMe } = useAuthContext();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    queryClient.clear();
    setMe(null);
  }, [queryClient, setMe]);
}

function FullPageStatus({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-canvas p-6">{children}</div>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, reload } = useAuthContext();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <FullPageStatus>
        <Spinner label="Checking your session" size="lg" />
      </FullPageStatus>
    );
  }
  if (state.status === 'error') {
    return (
      <FullPageStatus>
        <div className="w-full max-w-md">
          <ErrorState title="Can’t check your session" error={state.error} onRetry={reload} />
        </div>
      </FullPageStatus>
    );
  }
  if (state.status === 'signedOut') {
    const next = `${location.pathname}${location.search}${location.hash}`;
    const to = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}

/** Hides an admin-only page from members. The API enforces the role; this only avoids a dead end. */
export function RequireRole({ role, children }: { role: 'admin'; children: ReactNode }) {
  const { me } = useMe();
  if (me?.role !== role) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden />}
        title="You don’t have access to this page"
        description="Only admins can open it. Ask an admin of this gateway if you need access."
        action={
          <Link to="/" className={buttonClasses('secondary')}>
            Go to overview
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}
