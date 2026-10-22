import { clsx } from 'clsx';

/**
 * The product mark: one entry point fanning out to three servers, the gateway's whole job in a glyph.
 * Drawn with `currentColor` plus the signal colour, so it works on the dark rail and on light surfaces.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={clsx('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="var(--rail-signal)" fillOpacity="0.16" />
      <path d="M10 16h5m0 0 6-7m-6 7h6m-6 0 6 7" stroke="var(--rail-signal)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="16" r="2.75" fill="var(--rail-signal)" />
      <circle cx="23" cy="9" r="2" fill="currentColor" />
      <circle cx="23" cy="16" r="2" fill="currentColor" />
      <circle cx="23" cy="23" r="2" fill="currentColor" />
    </svg>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Urumi Gateway</span>
    </span>
  );
}
