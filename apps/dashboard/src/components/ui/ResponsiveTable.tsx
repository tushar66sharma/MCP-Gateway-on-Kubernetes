import { clsx } from 'clsx';
import type { MouseEvent, ReactNode } from 'react';
import { TABLE_BREAKPOINT, useMediaQuery } from '../../lib/useMediaQuery';
import { Table, TBody, Td, Th, THead, Tr } from './Table';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Classes for both the header and the cells of this column (width, alignment). */
  className?: string;
  align?: 'left' | 'right';
}

export interface ResponsiveTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** The phone layout of one row: a stacked card. */
  renderCard: (row: T) => ReactNode;
  /** Read by screen readers as the table's name. */
  caption?: ReactNode;
  /**
   * Makes the whole row clickable. Clicks on links and buttons inside the row are left to them, so the
   * row needs a real link for keyboard users; this only widens the mouse target.
   */
  onRowClick?: (row: T) => void;
}

function clickedInteractive(event: MouseEvent<HTMLElement>): boolean {
  return event.target instanceof Element && event.target.closest('a, button, input, select, textarea') !== null;
}

/**
 * Rows as a `<table>` from 640 px, and as a list of stacked cards below it. Only one of the two is
 * rendered (not both hidden by CSS), so tests and assistive technology see each row once.
 */
export function ResponsiveTable<T>({ columns, rows, rowKey, renderCard, caption, onRowClick }: ResponsiveTableProps<T>) {
  const wide = useMediaQuery(TABLE_BREAKPOINT);

  if (!wide) {
    return (
      <ul className="divide-y divide-border" aria-label={typeof caption === 'string' ? caption : undefined}>
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className={clsx('px-4 py-4', onRowClick && 'cursor-pointer')}
            {...(onRowClick && { onClick: (e: MouseEvent<HTMLElement>) => !clickedInteractive(e) && onRowClick(row) })}
          >
            {renderCard(row)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Table caption={caption}>
      <THead>
        <tr>
          {columns.map((c) => (
            <Th key={c.key} className={clsx(c.align === 'right' && 'text-right', c.className)}>
              {c.header}
            </Th>
          ))}
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr
            key={rowKey(row)}
            {...(onRowClick && {
              className: 'cursor-pointer',
              onClick: (e: MouseEvent<HTMLElement>) => !clickedInteractive(e) && onRowClick(row),
            })}
          >
            {columns.map((c) => (
              <Td key={c.key} className={clsx(c.align === 'right' && 'text-right tabular-nums', c.className)}>
                {c.cell(row)}
              </Td>
            ))}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
