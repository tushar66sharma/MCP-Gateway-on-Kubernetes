import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ApiError, errorMessage } from '../../lib/api';
import { toolCallsFromDetails } from './api';
import { ToolCallTrace } from './ToolCallTrace';

const secondsLabel = (n: number) => `${n} ${n === 1 ? 'second' : 'seconds'}`;

/** What the person sees for each error code. Provider text is never shown: it can echo request details. */
function friendlyMessage(error: unknown, remaining: number): string {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case 'LLM_RATE_LIMITED':
      return remaining > 0 ? `The AI provider is rate limited. Try again in ${secondsLabel(remaining)}.` : 'The AI provider is rate limited. You can try again now.';
    case 'LLM_AUTH_FAILED':
      return 'The AI provider rejected the API key. An admin needs to update it.';
    case 'LLM_UNAVAILABLE':
      return 'The AI provider is unavailable right now.';
    case 'LLM_BAD_RESPONSE':
      return 'The AI returned an unexpected answer. Try rephrasing.';
    case 'LLM_NOT_CONFIGURED':
      return 'The AI provider isn’t configured.';
    case 'RATE_LIMITED':
      return 'You’re sending messages too quickly.';
    case 'CONFLICT':
      return 'A reply is already being generated.';
    default:
      return errorMessage(error);
  }
}

/**
 * Counts down a `Retry-After`, in whole seconds; 0 when there is none or it has passed. The alert is
 * unmounted whenever a new turn starts, so one deadline per mount is enough.
 */
function useCountdown(error: unknown): number {
  const seconds = error instanceof ApiError ? (error.retryAfterSec ?? 0) : 0;
  const [end] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= end) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, end]);
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export interface ChatErrorProps {
  error: unknown;
  onRetry: () => void;
  pending: boolean;
}

/** The inline alert above the composer. The user's message stays in the thread, so Retry resends it. */
export function ChatError({ error, onRetry, pending }: ChatErrorProps) {
  const remaining = useCountdown(error);
  const ran = error instanceof ApiError ? toolCallsFromDetails(error.details) : [];
  return (
    <div role="alert" className="rounded-card border border-danger/40 bg-danger-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="flex min-w-0 items-start gap-2 text-sm font-medium text-danger">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{friendlyMessage(error, remaining)}</span>
        </p>
        <Button size="sm" icon={<RefreshCw aria-hidden />} disabled={pending || remaining > 0} onClick={onRetry}>
          Retry
        </Button>
      </div>
      {error instanceof ApiError && error.requestId ? (
        <p className="mt-2 text-xs text-fg-muted">
          Request ID <span className="font-mono select-all">{error.requestId}</span>
        </p>
      ) : null}
      {ran.length > 0 ? (
        <div className="mt-3">
          <p className="text-[0.8125rem] font-medium text-fg">These actions already ran. Check them before asking again, so nothing is created twice.</p>
          <ToolCallTrace calls={ran} defaultOpen />
        </div>
      ) : null}
    </div>
  );
}
