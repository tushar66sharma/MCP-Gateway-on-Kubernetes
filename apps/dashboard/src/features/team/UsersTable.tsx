import { useRef, useState } from 'react';
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

interface UserActionsProps {
  user: UserView;
  self: boolean;
  onDisabled: UsersTableProps['onDisabled'];
  onKeys: UsersTableProps['onKeys'];
}

function UserActions({ user: u, self, onDisabled, onKeys }: UserActionsProps) {
  // Disable and Enable replace each other, so the button that opened a dialog is gone afterwards:
  // focus returns to this container instead of dropping to the page.
  const boxRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={boxRef} tabIndex={-1} className="flex flex-wrap items-center justify-end gap-2 focus:outline-none">
      <Button size="sm" icon={<KeyRound aria-hidden />} aria-label={`Keys for ${u.name}`} onClick={(e) => onKeys(u, e.currentTarget)}>
        Keys…
      </Button>
      {u.disabled ? (
        <Button
          size="sm"
          icon={<UserCheck aria-hidden />}
          aria-label={`Enable ${u.name}`}
          onClick={() =>
            void onDisabled(u, false).then(
              () => boxRef.current?.focus(),
              () => undefined,
            )
          }
        >
          Enable
        </Button>
      ) : self ? (
        <Button size="sm" icon={<Power aria-hidden />} aria-label={`Disable ${u.name}`} title={SELF_HINT} disabled>
          Disable
        </Button>
      ) : (
        <ConfirmDialog
          returnFocusTo={boxRef}
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
}

interface RoleSelectProps {
  user: UserView;
  self: boolean;
  onRole: UsersTableProps['onRole'];
}

/**
 * A role change is a privilege change, and ArrowDown on a focused closed select fires `change` in some
 * browsers, so it is confirmed first. The select keeps showing the current role until the change is saved,
 * and is disabled while it is.
 */
function RoleSelect({ user: u, self, onRole }: RoleSelectProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const [proposed, setProposed] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (!proposed) return;
    setSaving(true);
    try {
      await onRole(u, proposed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Select
        ref={selectRef}
        aria-label={`Role for ${u.name}`}
        options={ROLE_OPTIONS}
        value={u.role}
        disabled={self || saving}
        {...(self && { title: SELF_HINT })}
        className="w-32"
        onChange={(e) => {
          const next = e.target.value as Role;
          if (next !== u.role) setProposed(next);
        }}
      />
      <ConfirmDialog
        open={proposed !== null}
        onOpenChange={(open) => {
          if (!open) setProposed(null);
        }}
        returnFocusTo={selectRef}
        tone="default"
        title={proposed === 'admin' ? `Make ${u.name} an admin?` : `Make ${u.name} a member?`}
        body={
          proposed === 'admin'
            ? 'Admins can manage servers, credentials and users, and see every audit row.'
            : `${u.name} loses admin rights at once: they can no longer manage servers, credentials or users, and see only their own audit rows.`
        }
        confirmLabel={proposed === 'admin' ? 'Make admin' : 'Make member'}
        onConfirm={confirm}
      />
    </>
  );
}

/** Users with a role select, Keys…, and Disable / Enable. Your own row cannot be demoted or disabled. */
export function UsersTable({ users, meId, onRole, onDisabled, onKeys }: UsersTableProps) {
  const roleSelect = (u: UserView) => <RoleSelect user={u} self={u.id === meId} onRole={onRole} />;

  const actions = (u: UserView) => <UserActions user={u} self={u.id === meId} onDisabled={onDisabled} onKeys={onKeys} />;

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
