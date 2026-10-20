import { Eye, EyeOff } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { BrandMark, BrandName } from '../components/layout/BrandMark';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Input } from '../components/ui/Input';
import { ApiError, NETWORK_MESSAGE, errorMessage } from '../lib/api';
import { useLogin, useMe } from '../lib/auth';

const BASE = 'http://same-origin.invalid';

/**
 * Where to go after login. Only a same-origin path is accepted: it must start with one `/` (not `//`,
 * which is protocol-relative, and no `\`, which browsers treat as `/`) and must not leave the origin once
 * resolved. Anything else (and `/login` itself) falls back to `/`, so `?next=` can't be an open redirect.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/';
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE || url.pathname === '/login') return '/';
  } catch {
    return '/';
  }
  return raw;
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INVALID_CREDENTIALS') return 'Email or password is incorrect';
    if (err.code === 'RATE_LIMITED') {
      const n = err.retryAfterSec;
      if (n === undefined) return 'Too many attempts. Try again in a minute';
      return `Too many attempts. Try again in ${n} ${n === 1 ? 'second' : 'seconds'}`;
    }
    if (err.code === 'NETWORK') return NETWORK_MESSAGE;
  }
  return errorMessage(err);
}

function RouteDiagram() {
  const servers = ['WooCommerce store', 'Notes', 'Utilities'];
  return (
    <figure className="w-full max-w-sm">
      <svg viewBox="0 0 320 200" aria-hidden className="w-full" fill="none">
        <path d="M74 100h66" stroke="var(--rail-signal)" strokeWidth="2" />
        <path d="M180 100c30 0 30-62 60-62M180 100h60M180 100c30 0 30 62 60 62" stroke="var(--rail-muted)" strokeOpacity="0.55" strokeWidth="1.5" />
        <rect x="8" y="82" width="66" height="36" rx="8" stroke="var(--rail-muted)" strokeOpacity="0.6" />
        <rect x="140" y="78" width="40" height="44" rx="10" fill="var(--rail-signal)" fillOpacity="0.18" stroke="var(--rail-signal)" strokeWidth="1.5" />
        <circle cx="160" cy="100" r="5" fill="var(--rail-signal)" />
        {[38, 100, 162].map((y) => (
          <circle key={y} cx="244" cy={y} r="4" fill="var(--rail-fg)" />
        ))}
      </svg>
      <figcaption className="sr-only">MCP clients connect to the gateway, which routes each tool call to the right server.</figcaption>
      <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-start gap-4 text-xs text-rail-muted">
        <span>Your MCP client</span>
        <span className="font-medium text-rail-fg">Gateway</span>
        <ul className="flex flex-col gap-1 text-right">
          {servers.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function Login() {
  const { me } = useMe();
  const login = useLogin();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Signed in (already, or just now): leave for the requested page.
  if (me) return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (email.trim() === '') errors.email = 'Enter your email';
    if (password === '') errors.password = 'Enter your password';
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // The `me` redirect above takes over on the next render.
    } catch (err) {
      setFormError(loginErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <BrandName className="text-fg" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] text-fg">Sign in</h1>
            <p className="mt-2 text-sm text-fg-muted">Manage the MCP servers, keys and tool access for your team.</p>

            <form className="mt-8 flex flex-col gap-5" noValidate onSubmit={(e) => void onSubmit(e)}>
              <FormField label="Email" error={fieldErrors.email}>
                <Input
                  ref={emailRef}
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FormField>
              <FormField label="Password" error={fieldErrors.password}>
                <Input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  trailing={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      icon={showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      onClick={() => setShowPassword((v) => !v)}
                    />
                  }
                />
              </FormField>

              {formError ? (
                <div role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3.5 py-3 text-sm text-danger">
                  {formError}
                </div>
              ) : null}

              <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
                Sign in
              </Button>
            </form>
            <p className="mt-6 text-[0.8125rem] text-fg-subtle">New here? Ask an admin of this gateway for an invite link.</p>
          </div>
        </div>
      </main>
      <aside aria-label="About the gateway" className="hidden flex-col justify-between bg-rail p-12 text-rail-fg lg:flex">
        <BrandMark className="size-10" />
        <div className="flex flex-col items-start gap-10">
          <RouteDiagram />
          <p className="max-w-md text-lg leading-snug font-medium tracking-[-0.01em]">
            One endpoint and one key for every MCP server your team uses, with each call checked and logged.
          </p>
        </div>
        <span />
      </aside>
    </div>
  );
}
