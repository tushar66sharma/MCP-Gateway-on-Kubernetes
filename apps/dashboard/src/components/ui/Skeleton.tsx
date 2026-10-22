import { clsx } from 'clsx';

/** A placeholder block while data loads. Decorative: pair it with a labelled loading region. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-control bg-surface-hover motion-reduce:animate-none', className)} />;
}

/** A loading list: `rows` skeleton lines inside a region announced as busy. */
export function SkeletonList({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
