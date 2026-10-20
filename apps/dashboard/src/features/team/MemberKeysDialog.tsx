import { useId, useState, type RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogClose } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { KeyCreatedDialog } from '../keys/KeyCreatedDialog';
import { KeysTable } from '../keys/KeysTable';
import type { KeyView } from '../keys/api';
import { createUserKey, revokeUserKey, useInvalidateTeam, useUserKeys, type UserView } from './api';

export interface MemberKeysDialogProps {
  user: UserView | null;
  /** The signed-in admin: admins may issue keys only for members and for themselves. */
  meId: string | undefined;
  onClose: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/** One user's API keys for an admin: list, issue (members only) and revoke. */
export function MemberKeysDialog({ user, meId, onClose, returnFocusTo }: MemberKeysDialogProps) {
  const formId = useId();
  const invalidate = useInvalidateTeam();
  const keys = useUserKeys(user?.id ?? '', user !== null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [issuing, setIssuing] = useState(false);
  // The issued key's plaintext lives only in this state; its dialog's Close drops it.
  const [plaintext, setPlaintext] = useState<string | null>(null);

  // Forget the form whenever the dialog opens or closes.
  const [lastUserId, setLastUserId] = useState(user?.id ?? null);
  if ((user?.id ?? null) !== lastUserId) {
    setLastUserId(user?.id ?? null);
    setName('');
    setNameError(undefined);
    setIssuing(false);
    setPlaintext(null);
  }

  const canIssue = user !== null && (user.role === 'member' || user.id === meId);

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (user === null) return;
    const trimmed = name.trim();
    if (trimmed === '') return setNameError('Enter a name for the key');
    if (trimmed.length > 60) return setNameError('Use 60 characters or fewer');
    setIssuing(true);
    try {
      const created = await createUserKey(user.id, trimmed);
      setPlaintext(created.plaintext);
      setName('');
      void invalidate.userKeys(user.id);
    } catch (err) {
      // A disabled user answers 409 and an admin target 403; both read as a plain message here.
      setNameError(errorMessage(err));
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (key: KeyView) => {
    if (user === null) return;
    try {
      await revokeUserKey(user.id, key.id);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    await invalidate.userKeys(user.id);
    toast.success(`Revoked ${key.name}`);
  };

  let list;
  if (keys.isPending) list = <SkeletonList rows={2} label="Loading keys" />;
  else if (keys.isError) list = <ErrorState title="Keys didn’t load" error={keys.error} onRetry={() => void keys.refetch()} retrying={keys.isFetching} />;
  else if (keys.data.length === 0) list = <EmptyState title="No keys" description="This user has no API keys." className="py-8" />;
  else list = <KeysTable keys={keys.data} caption={`API keys of ${user?.name ?? 'user'}`} onRevoke={revoke} />;

  return (
    <>
      <Dialog
        open={user !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        {...(returnFocusTo && { returnFocusTo })}
        size="lg"
        title={user ? `API keys of ${user.name}` : 'API keys'}
        description={user?.email}
        footer={
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        }
      >
        <div className="flex flex-col gap-5">
          {user !== null && canIssue ? (
            <form id={formId} onSubmit={(e) => void issue(e)} noValidate className="flex items-start gap-2">
              <FormField label="Key name" required error={nameError} className="min-w-0 flex-1">
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(undefined);
                  }}
                  autoComplete="off"
                  maxLength={60}
                />
              </FormField>
              <Button type="submit" variant="primary" loading={issuing} className="mt-[1.625rem]">
                Issue key
              </Button>
            </form>
          ) : user !== null ? (
            <p className="rounded-control bg-surface-sunken px-3.5 py-3 text-sm text-fg-muted">
              Admins create their own keys on the API keys page. You can still revoke the ones listed here.
            </p>
          ) : null}
          <div className="overflow-hidden rounded-card border border-border">{list}</div>
        </div>
      </Dialog>
      <KeyCreatedDialog plaintext={plaintext} onClose={() => setPlaintext(null)} />
    </>
  );
}
