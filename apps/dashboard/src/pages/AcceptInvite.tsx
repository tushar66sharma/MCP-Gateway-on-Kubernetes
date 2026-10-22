import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, LinkIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BrandName } from '../components/layout/BrandMark';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { FormField } from '../components/ui/FormField';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { ApiError, errorMessage } from '../lib/api';
import { useMe, useStartSession } from '../lib/auth';
import { acceptInvite, fetchInvitePreview } from '../features/team/api';

interface Errors {
  name?: string;
  password?: string;
  confirm?: string;
  form?: string;
}

function validate(name: string, password: string, confirm: string): Errors {
  const errors: Errors = {};
  const trimmed = name.trim();
  if (trimmed === '') errors.name = 'Enter your name';
  else if (trimmed.length > 100) errors.name = 'Use 100 characters or fewer';
  if (password.length < 10) errors.password = 'Use at least 10 characters';
  else if (password.length > 200) errors.password = 'Use 200 characters or fewer';
  if (confirm !== password) errors.confirm = 'Passwords don’t match';
  return errors;
}

const isInvalidInvite = (err: unknown) => err instanceof ApiError && err.code === 'INVITE_INVALID';

/** Keeps the invite token out of Referer headers while this page is open (beside the nginx header). */
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-4 py-8 sm:px-10">
      <BrandName className="text-fg" />
      <main className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

/** Public page behind an invite link: preview the invite, then create the account and sign in. */
export function AcceptInvite() {
  useNoReferrer();
  const { token = '' } = useParams();
  const { me } = useMe();
  const startSession = useStartSession();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: ({ signal }) => fetchInvitePreview(token, signal),
    retry: false,
    gcTime: 0,
  });

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState(false);

  if (preview.isPending) {
    return (
      <Shell>
        <div className="grid place-items-center py-16">
          <Spinner label="Checking your invite" size="lg" />
        </div>
      </Shell>
    );
  }
  if (rejected || (preview.isError && isInvalidInvite(preview.error))) {
    return (
      <Shell>
        <EmptyState
          icon={<LinkIcon aria-hidden />}
          title="Invite link not valid"
          description="This invite link is invalid or has expired. Ask your admin for a new one."
        />
      </Shell>
    );
  }
  if (preview.isError) {
    return (
      <Shell>
        <ErrorState title="The invite didn’t load" error={preview.error} onRetry={() => void preview.refetch()} retrying={preview.isFetching} />
      </Shell>
    );
  }

  const invite = preview.data;
  const clear = (key: keyof Errors) => setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate(name, password, confirm);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const { user } = await acceptInvite(token, { name: name.trim(), password });
      startSession(user);
      void navigate('/', { replace: true });
    } catch (err) {
      if (isInvalidInvite(err)) setRejected(true);
      else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') setErrors({ form: err.message });
      else setErrors({ form: errorMessage(err) });
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] text-fg">You’ve been invited as {invite.role}</h1>
      <p className="mt-2 text-sm text-fg-muted">Choose a name and password to create your account.</p>
      {me ? (
        <p role="status" className="mt-4 rounded-control bg-surface-sunken px-3.5 py-3 text-sm text-fg-muted">
          You are signed in as {me.name}; accepting creates a new account and signs you in as that account.
        </p>
      ) : null}

      <form className="mt-6 flex flex-col gap-5" noValidate onSubmit={(e) => void onSubmit(e)}>
        <FormField label="Email">
          <Input type="email" value={invite.email} readOnly autoComplete="username" />
        </FormField>
        <FormField label="Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clear('name');
            }}
            autoComplete="name"
            maxLength={100}
          />
        </FormField>
        <FormField label="Password" required error={errors.password} hint="At least 10 characters.">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear('password');
            }}
            autoComplete="new-password"
            maxLength={200}
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
        <FormField label="Confirm password" required error={errors.confirm}>
          <Input
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              clear('confirm');
            }}
            autoComplete="new-password"
            maxLength={200}
          />
        </FormField>

        {errors.form ? (
          <div role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3.5 py-3 text-sm text-danger">
            {errors.form}
          </div>
        ) : null}

        <Button type="submit" variant="primary" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>
    </Shell>
  );
}
