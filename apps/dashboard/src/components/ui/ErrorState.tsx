import { clsx } from 'clsx';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { ApiError, errorMessage } from '../../lib/api';
import { Button } from './Button';

export interface ErrorStateProps {
  error: unknown;
  /** Re-runs the failed load (usually a query's `refetch`). */
  onRetry?: () => void;
  title?: string;
  retrying?: boolean;
  className?: string;
}

/** What a data view shows when its load failed: what happened, the request id, and a retry. */
export function ErrorState({ error, onRetry, title = 'This didn’t load', retrying = false, className }: ErrorStateProps) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className={clsx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-danger-subtle text-danger">
        <TriangleAlert aria-hidden className="size-5" />
      </div>
      <h2 className="text-[0.9375rem] font-semibold text-fg">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{errorMessage(error)}</p>
      {requestId ? (
        <p className="mt-2 text-xs text-fg-subtle">
          Request ID <span className="font-mono select-all">{requestId}</span>
        </p>
      ) : null}
      {onRetry ? (
        <Button className="mt-5" icon={<RefreshCw aria-hidden />} loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
