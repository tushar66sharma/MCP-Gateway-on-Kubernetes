import { Ban } from 'lucide-react';
import { useRef } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ResponsiveTable, type Column } from '../../components/ui/ResponsiveTable';
import { formatDateTime, formatRelative } from '../../lib/format';
import type { KeyView } from './api';

export interface KeysTableProps {
  keys: KeyView[];
  caption: string;
  /** Revokes one key. Reject to keep the confirm open (the caller shows the error). */
  onRevoke: (key: KeyView) => Promise<void>;
}

function KeyStatus({ revokedAt }: { revokedAt: string | null }) {
  return revokedAt === null ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Revoked</Badge>;
}

/** Keys of one user: name, prefix, dates, status and a confirmed Revoke. Used for own keys and a member's. */
export function KeysTable({ keys, caption, onRevoke }: KeysTableProps) {
  // The Revoke button disappears once the key is revoked, so focus returns to the list instead.
  const listRef = useRef<HTMLDivElement>(null);

  const revoke = (k: KeyView) =>
    k.revokedAt === null ? (
      <ConfirmDialog
        returnFocusTo={listRef}
        trigger={
          <Button size="sm" icon={<Ban aria-hidden />} aria-label={`Revoke ${k.name}`}>
            Revoke
          </Button>
        }
        title={`Revoke ${k.name}?`}
        body="Clients using this key stop working immediately. This cannot be undone."
        confirmLabel="Revoke key"
        onConfirm={() => onRevoke(k)}
      />
    ) : null;

  const columns: Column<KeyView>[] = [
    { key: 'name', header: 'Name', cell: (k) => <span className="font-medium text-fg">{k.name}</span> },
    { key: 'prefix', header: 'Key', cell: (k) => <span className="font-mono text-xs text-fg-muted">{k.prefix}…</span> },
    { key: 'created', header: 'Created', cell: (k) => <span className="text-fg-muted">{formatDateTime(k.createdAt)}</span> },
    { key: 'used', header: 'Last used', cell: (k) => <span className="text-fg-muted">{formatRelative(k.lastUsedAt)}</span> },
    { key: 'status', header: 'Status', cell: (k) => <KeyStatus revokedAt={k.revokedAt} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: revoke },
  ];

  return (
    <div ref={listRef} tabIndex={-1} className="focus:outline-none">
      <ResponsiveTable
        caption={caption}
        columns={columns}
        rows={keys}
        rowKey={(k) => k.id}
        renderCard={(k) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 font-medium break-words text-fg">{k.name}</span>
              <KeyStatus revokedAt={k.revokedAt} />
            </div>
            <p className="font-mono text-xs text-fg-muted">{k.prefix}…</p>
            <p className="text-[0.8125rem] text-fg-muted">
              Created {formatDateTime(k.createdAt)} · last used {formatRelative(k.lastUsedAt)}
            </p>
            {revoke(k)}
          </div>
        )}
      />
    </div>
  );
}
