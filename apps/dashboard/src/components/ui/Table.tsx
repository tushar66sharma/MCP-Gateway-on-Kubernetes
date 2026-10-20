import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

/** Styled table primitives. Pages usually want `ResponsiveTable`, which switches to cards on phones. */
export function Table({ caption, className, children }: { caption?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={clsx('w-full border-collapse text-left text-sm', className)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-border bg-surface-sunken">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={clsx('transition-colors hover:bg-surface-hover/60', className)} {...rest} />;
}

export function Th({ className, scope = 'col', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={clsx('h-10 px-4 text-[0.8125rem] font-medium whitespace-nowrap text-fg-muted first:pl-5 last:pr-5', className)}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx('px-4 py-3 align-middle text-fg first:pl-5 last:pr-5', className)} {...rest} />;
}
