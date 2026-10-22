import { clsx } from 'clsx';

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

/**
 * A spinning ring. Without `label` it is decorative (inside a busy button, for example); with `label` it
 * announces itself as a status ("Checking your session").
 */
export function Spinner({ size = 'md', label, className }: { size?: keyof typeof sizes; label?: string; className?: string }) {
  const ring = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={clsx(sizes[size], 'animate-spin', !label && className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return ring;
  return (
    <span role="status" className={clsx('inline-flex flex-col items-center gap-3 text-fg-muted', className)}>
      {ring}
      <span className="text-sm">{label}</span>
    </span>
  );
}
