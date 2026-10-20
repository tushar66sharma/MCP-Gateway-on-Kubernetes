import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-subtle text-fg-muted',
  accent: 'bg-accent-subtle text-accent-text',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-warning-subtle text-warning',
};

/** A small label: roles, sources, counts. Colour is never the only signal; the text always says it. */
export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
