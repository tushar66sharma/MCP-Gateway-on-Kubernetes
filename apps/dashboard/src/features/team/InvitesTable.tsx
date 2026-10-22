import { X } from 'lucide-react';
import { useRef } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ResponsiveTable, type Column } from '../../components/ui/ResponsiveTable';
import { formatRelative } from '../../lib/format';
import type { InviteView } from './api';

export interface InvitesTableProps {
  invites: InviteView[];
  onCancel: (invite: InviteView) => Promise<void>;
}

function Expiry({ invite }: { invite: InviteView }) {
  return (
    <span className="inline-flex items-center gap-2 text-fg-muted">
      {invite.expired ? <Badge tone="warning">Expired</Badge> : null}
      {invite.expired ? 'expired ' : 'expires '}
      {formatRelative(invite.expiresAt)}
    </span>
  );
}

export function InvitesTable({ invites, onCancel }: InvitesTableProps) {
  // The Cancel button disappears with its row, so focus returns to the list.
  const listRef = useRef<HTMLDivElement>(null);

  const cancel = (i: InviteView) => (
    <ConfirmDialog
      returnFocusTo={listRef}
      trigger={
        <Button size="sm" icon={<X aria-hidden />} aria-label={`Cancel invite for ${i.email}`}>
          Cancel
        </Button>
      }
      title="Cancel this invite?"
      body={`The link sent to ${i.email} stops working.`}
      confirmLabel="Cancel invite"
      cancelLabel="Keep invite"
      onConfirm={() => onCancel(i)}
    />
  );

  const columns: Column<InviteView>[] = [
    { key: 'email', header: 'Email', cell: (i) => <span className="font-medium break-all text-fg">{i.email}</span> },
    { key: 'role', header: 'Role', cell: (i) => <span className="text-fg-muted capitalize">{i.role}</span> },
    { key: 'expires', header: 'Expires', cell: (i) => <Expiry invite={i} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: cancel },
  ];

  return (
    <div ref={listRef} tabIndex={-1} className="focus:outline-none">
      <ResponsiveTable
        caption="Pending invites"
        columns={columns}
        rows={invites}
        rowKey={(i) => i.id}
        renderCard={(i) => (
          <div className="flex flex-col gap-2">
            <p className="font-medium break-all text-fg">{i.email}</p>
            <p className="text-[0.8125rem] text-fg-muted capitalize">{i.role}</p>
            <Expiry invite={i} />
            {cancel(i)}
          </div>
        )}
      />
    </div>
  );
}
