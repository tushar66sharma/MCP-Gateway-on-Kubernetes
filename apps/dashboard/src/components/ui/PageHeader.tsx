import type { ReactNode } from 'react';

/** The top of every page: the one `<h1>`, a sentence about the page, and its main actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.5rem] leading-tight font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
