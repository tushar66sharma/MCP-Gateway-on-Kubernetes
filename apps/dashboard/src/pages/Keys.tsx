import { KeyRound, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/Skeleton';
import { toast } from '../components/ui/Toast';
import { errorMessage } from '../lib/api';
import { createKey, revokeKey, useInvalidateKeys, useKeys, type KeyView } from '../features/keys/api';
import { CreateKeyDialog } from '../features/keys/CreateKeyDialog';
import { KeyCreatedDialog } from '../features/keys/KeyCreatedDialog';
import { KeysTable } from '../features/keys/KeysTable';

export function Keys() {
  const keys = useKeys();
  const invalidate = useInvalidateKeys();
  const [creating, setCreating] = useState(false);
  // The new key's plaintext lives only in this state; KeyCreatedDialog's Close drops it.
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);

  const revoke = async (key: KeyView) => {
    try {
      await revokeKey(key.id);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    await invalidate();
    toast.success(`Revoked ${key.name}`);
  };

  let body;
  if (keys.isPending) body = <SkeletonList rows={3} label="Loading API keys" />;
  else if (keys.isError) {
    body = <ErrorState title="API keys didn’t load" error={keys.error} onRetry={() => void keys.refetch()} retrying={keys.isFetching} />;
  } else if (keys.data.length === 0) {
    body = (
      <EmptyState
        icon={<KeyRound aria-hidden />}
        title="No API keys yet"
        description="Create a key to let an MCP client such as Claude Code or Cursor call tools as you."
        action={
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
            Create key
          </Button>
        }
      />
    );
  } else body = <KeysTable keys={keys.data} caption="Your API keys" onRevoke={revoke} />;

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys that let MCP clients such as Claude Code and Cursor call tools as you."
        actions={
          <Button ref={createRef} variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
            Create key
          </Button>
        }
      />
      <div className="overflow-hidden rounded-card border border-border bg-surface">{body}</div>
      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        returnFocusTo={createRef}
        create={createKey}
        onCreated={(created) => {
          setPlaintext(created.plaintext);
          void invalidate();
        }}
      />
      <KeyCreatedDialog plaintext={plaintext} onClose={() => setPlaintext(null)} returnFocusTo={createRef} />
    </>
  );
}
