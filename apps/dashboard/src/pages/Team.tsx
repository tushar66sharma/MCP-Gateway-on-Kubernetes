import { MailPlus, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/Skeleton';
import { toast } from '../components/ui/Toast';
import { errorMessage } from '../lib/api';
import { useMe } from '../lib/auth';
import {
  cancelInvite,
  patchUser,
  useInvalidateTeam,
  useInvites,
  useUsers,
  type InviteView,
  type Role,
  type UserView,
} from '../features/team/api';
import { InviteCreatedDialog } from '../features/team/InviteCreatedDialog';
import { InviteDialog } from '../features/team/InviteDialog';
import { InvitesTable } from '../features/team/InvitesTable';
import { MemberKeysDialog } from '../features/team/MemberKeysDialog';
import { UsersTable } from '../features/team/UsersTable';

function Section({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.01em] text-fg">{title}</h2>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
        {actions}
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface">{children}</div>
    </section>
  );
}

/** Admin page: people, their roles and keys, and pending invites. The API enforces the role. */
export function Team() {
  const { me } = useMe();
  const users = useUsers();
  const invites = useInvites();
  const invalidate = useInvalidateTeam();

  const [keysUser, setKeysUser] = useState<UserView | null>(null);
  const keysOpener = useRef<HTMLElement | null>(null);
  const [inviting, setInviting] = useState(false);
  const inviteRef = useRef<HTMLButtonElement>(null);
  // The invite link lives only in this state; its dialog's Done drops it.
  const [link, setLink] = useState<string | null>(null);

  const change = async (user: UserView, body: { role: Role } | { disabled: boolean }, done: string) => {
    try {
      await patchUser(user.id, body);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    await invalidate.users();
    toast.success(done);
  };

  const cancel = async (invite: InviteView) => {
    try {
      await cancelInvite(invite.id);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    await invalidate.invites();
    toast.success(`Cancelled the invite for ${invite.email}`);
  };

  let userBody;
  if (users.isPending) userBody = <SkeletonList rows={3} label="Loading users" />;
  else if (users.isError) {
    userBody = <ErrorState title="Users didn’t load" error={users.error} onRetry={() => void users.refetch()} retrying={users.isFetching} />;
  } else if (users.data.length === 0) userBody = <EmptyState icon={<Users aria-hidden />} title="No users" />;
  else {
    userBody = (
      <UsersTable
        users={users.data}
        meId={me?.id}
        onRole={(u, role) => change(u, { role }, `${u.name} is now ${role === 'admin' ? 'an admin' : 'a member'}`)}
        onDisabled={(u, disabled) => change(u, { disabled }, disabled ? `Disabled ${u.name}` : `Enabled ${u.name}`)}
        onKeys={(u, opener) => {
          keysOpener.current = opener;
          setKeysUser(u);
        }}
      />
    );
  }

  let inviteBody;
  if (invites.isPending) inviteBody = <SkeletonList rows={2} label="Loading invites" />;
  else if (invites.isError) {
    inviteBody = <ErrorState title="Invites didn’t load" error={invites.error} onRetry={() => void invites.refetch()} retrying={invites.isFetching} />;
  } else if (invites.data.length === 0) {
    inviteBody = (
      <EmptyState
        icon={<MailPlus aria-hidden />}
        title="No pending invites"
        description="Invite someone to give them an account. You send them the link yourself."
        action={
          <Button variant="primary" onClick={() => setInviting(true)}>
            Invite member
          </Button>
        }
      />
    );
  } else inviteBody = <InvitesTable invites={invites.data} onCancel={cancel} />;

  return (
    <>
      <PageHeader title="Team" description="Invite people, set their roles and manage their access." />
      <div className="flex flex-col gap-8">
        <Section title="Users" description="Everyone with an account on this gateway.">
          {userBody}
        </Section>
        <Section
          title="Pending invites"
          description="Links that have not been used yet."
          actions={
            <Button ref={inviteRef} variant="primary" icon={<MailPlus aria-hidden />} onClick={() => setInviting(true)}>
              Invite member
            </Button>
          }
        >
          {inviteBody}
        </Section>
      </div>
      <MemberKeysDialog user={keysUser} meId={me?.id} onClose={() => setKeysUser(null)} returnFocusTo={keysOpener} />
      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        returnFocusTo={inviteRef}
        onCreated={(newLink) => {
          setLink(newLink);
          void invalidate.invites();
        }}
      />
      <InviteCreatedDialog link={link} onClose={() => setLink(null)} returnFocusTo={inviteRef} />
    </>
  );
}
