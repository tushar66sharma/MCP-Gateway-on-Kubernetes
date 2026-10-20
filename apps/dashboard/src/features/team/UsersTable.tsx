import { KeyRound, Power, UserCheck } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ResponsiveTable, type Column } from '../../components/ui/ResponsiveTable';
import { Select } from '../../components/ui/Select';
import { formatDate } from '../../lib/format';
import type { Role, UserView } from './api';

export interface UsersTableProps {
  users: UserView[];
  meId: string | undefined;
  onRole: (user: UserView, role: Role) => Promise<void>;
  onDisabled: (user: UserView, disabled: boolean) => Promise<void>;
  onKeys: (user: UserView, opener: HTMLElement) => void;
}

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];
const SELF_HINT = 'You cannot change your own role or disable yourself';

function Status({ disabled }: { disabled: boolean }) {
  return disabled ? <Badge tone="neutral">Disabled</Badge> : <Badge tone="success">Active</Badge>;
}

/** Users with a role select, Keys…, and Disable / Enable. Your own row cannot be demoted or disabled. */
export function UsersTable({ users, meId, onRole, onDisabled, onKeys }: UsersTableProps) {
  const roleSelect = (u: UserView) => {
    const self = u.id === meId;
    return (
      <Select
        aria-label={`Role for ${u.name}`}
        options={ROLE_OPTIONS}
        value={u.role}
        disabled={self}
        {...(self && { title: SELF_HINT })}
        className="w-32"
        onChange={(e) => void onRole(u, e.target.value as Role).catch(() => undefined)}
      />
    );
  };

  const actions = (u: UserView) => {
    const self = u.id === meId;
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" icon={<KeyRound aria-hidden />} aria-label={`Keys for ${u.name}`} onClick={(e) => onKeys(u, e.currentTarget)}>
          Keys…
        </Button>
        {u.disabled ? (
          <Button size="sm" icon={<UserCheck aria-hidden />} aria-label={`Enable ${u.name}`} onClick={() => void onDisabled(u, false).catch(() => undefined)}>
            Enable
          </Button>
        ) : self ? (
          <Button size="sm" icon={<Power aria-hidden />} aria-label={`Disable ${u.name}`} title={SELF_HINT} disabled>
            Disable
          </Button>
        ) : (
          <ConfirmDialog
            trigger={
              <Button size="sm" icon={<Power aria-hidden />} aria-label={`Disable ${u.name}`}>
                Disable
              </Button>
            }
            title={`Disable ${u.name}?`}
            body="Disabling signs them out and revokes all their API keys. You can enable the account again, but the keys stay revoked."
            confirmLabel="Disable user"
            onConfirm={() => onDisabled(u, true)}
          />
        )}
      </div>
    );
  };

  const identity = (u: UserView) => (
    <div className="min-w-0">
      <p className="font-medium break-words text-fg">
        {u.name}
        {u.id === meId ? <span className="ml-2 text-xs font-normal text-fg-subtle">(you)</span> : null}
      </p>
      <p className="text-[0.8125rem] break-all text-fg-muted">{u.email}</p>
    </div>
  );

  const columns: Column<UserView>[] = [
    { key: 'user', header: 'User', cell: identity },
    { key: 'role', header: 'Role', cell: roleSelect },
    { key: 'status', header: 'Status', cell: (u) => <Status disabled={u.disabled} /> },
    { key: 'created', header: 'Created', cell: (u) => <span className="text-fg-muted">{formatDate(u.createdAt)}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: actions },
  ];

  return (
    <ResponsiveTable
      caption="Users"
      columns={columns}
      rows={users}
      rowKey={(u) => u.id}
      renderCard={(u) => (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            {identity(u)}
            <Status disabled={u.disabled} />
          </div>
          {roleSelect(u)}
          <p className="text-[0.8125rem] text-fg-muted">Created {formatDate(u.createdAt)}</p>
          {actions(u)}
        </div>
      )}
    />
  );
}
