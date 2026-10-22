import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons or links on the right of the header. */
  actions?: ReactNode;
  /** Removes the body padding (for a table that runs edge to edge). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
  /** `section` when the card has a title (it becomes a labelled region), `div` otherwise. */
  as?: 'section' | 'div';
}

/** A bordered panel. Cards have no shadow: elevation is reserved for things that float. */
export function Card({ title, description, actions, flush = false, className, children, as }: CardProps) {
  const Tag = as ?? (title ? 'section' : 'div');
  return (
    <Tag className={clsx('overflow-hidden rounded-card border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </Tag>
  );
}
