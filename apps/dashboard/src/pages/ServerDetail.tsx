import { ArrowLeft, Pencil, Power, RefreshCw, SearchX, Trash2, TriangleAlert } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClasses } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { toast } from '../components/ui/Toast';
import { ApiError } from '../lib/api';
import { formatDateTime, formatRelative } from '../lib/format';
import { useMe } from '../lib/auth';
import { deleteServer, patchServer, refreshServer, SEEDED_SLUGS, useInvalidateServers, useServer, type ServerView } from '../features/servers/api';
import { ServerFormDialog } from '../features/servers/ServerFormDialog';
import { ToolList } from '../features/servers/ToolList';

const AUTH_LABEL = { none: 'None', bearer: 'Bearer token', header: 'Custom header' } as const;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-[0.8125rem] font-medium text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

function Back() {
  return (
    <Link to="/servers" className={buttonClasses('ghost', 'sm', '-ml-3 mb-3')}>
      <ArrowLeft aria-hidden /> All servers
    </Link>
  );
}

function Actions({ server, returnFocusTo }: { server: ServerView; returnFocusTo: RefObject<HTMLElement | null> }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateServers();
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const seeded = SEEDED_SLUGS.includes(server.slug);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof ApiError ? err : 'Something went wrong.');
      throw err;
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await run(async () => {
        const next = await refreshServer(server.id);
        await invalidate();
        toast.success(`Refreshed: ${next.status}`);
      });
    } catch {
      // Reported by the toast.
    } finally {
      setRefreshing(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    await run(async () => {
      await patchServer(server.id, { enabled });
      await invalidate();
      toast.success(enabled ? `${server.name} enabled` : `${server.name} disabled`);
    });
  };

  return (
    <>
      <Button ref={editRef} icon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button icon={<RefreshCw aria-hidden />} loading={refreshing} onClick={() => void refresh()}>
        Refresh now
      </Button>
      {server.enabled ? (
        <ConfirmDialog
          trigger={<Button icon={<Power aria-hidden />}>Disable</Button>}
          title={`Disable ${server.name}?`}
          body={`Its ${server.toolCount === 1 ? 'tool is' : 'tools are'} removed from the gateway until you enable it again. Clients and the chat can no longer call them.`}
          confirmLabel="Disable server"
          returnFocusTo={returnFocusTo}
          onConfirm={() => setEnabled(false)}
        />
      ) : (
        <Button
          icon={<Power aria-hidden />}
          loading={enabling}
          onClick={() => {
            setEnabling(true);
            void setEnabled(true).catch(() => undefined).finally(() => setEnabling(false));
          }}
        >
          Enable
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <Button variant="danger" icon={<Trash2 aria-hidden />}>
            Delete
          </Button>
        }
        title={`Delete ${server.name}?`}
        body={
          <>
            <p>
              The gateway stops serving its tools immediately. Past audit entries are kept.
            </p>
            {seeded ? (
              <p className="mt-2">
                {server.slug} is a built-in server: once deleted it stays deleted, and you can re-add it later with Add server.
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete server"
        returnFocusTo={returnFocusTo}
        onConfirm={() =>
          run(async () => {
            await deleteServer(server.id);
            await invalidate();
            toast.success(`${server.name} deleted`);
            void navigate('/servers');
          })
        }
      />
      <ServerFormDialog open={editing} onOpenChange={setEditing} server={server} returnFocusTo={editRef} />
    </>
  );
}

export function ServerDetail() {
  const { id } = useParams();
  const { me } = useMe();
  const query = useServer(id);
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (query.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading server" className="flex flex-col gap-4">
        <Back />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <Back />
        <div className="rounded-card border border-border bg-surface">
          {notFound ? (
            <EmptyState
              icon={<SearchX aria-hidden />}
              title="Server not found"
              description="It may have been deleted. Go back to the list of servers."
              action={
                <Link to="/servers" className={buttonClasses('secondary')}>
                  Back to servers
                </Link>
              }
            />
          ) : (
            <ErrorState title="This server didn’t load" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
          )}
        </div>
      </>
    );
  }

  const server = query.data;
  return (
    <>
      <Back />
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 ref={headingRef} tabIndex={-1} className="text-[1.5rem] leading-tight font-semibold tracking-[-0.02em] text-fg">{server.name}</h1>
            <StatusBadge status={server.status} />
          </div>
          <p className="mt-1.5 font-mono text-sm text-fg-subtle">{server.slug}</p>
        </div>
        {me?.role === 'admin' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Actions server={server} returnFocusTo={headingRef} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        <Card title="Details">
          <dl className="divide-y divide-border">
            <Info label="URL">
              <span className="font-mono text-[0.8125rem]">{server.url}</span>
            </Info>
            <Info label="Authentication">{AUTH_LABEL[server.authType]}</Info>
            {server.authType === 'header' ? <Info label="Header name">{server.authHeaderName ?? '—'}</Info> : null}
            <Info label="Credential stored">{server.hasCredential ? 'Yes' : 'No'}</Info>
            <Info label="Last checked">
              {server.checkedAt ? `${formatRelative(server.checkedAt)} (${formatDateTime(server.checkedAt)})` : 'Never'}
            </Info>
            <Info label="Last error">{server.lastError ?? '—'}</Info>
          </dl>
        </Card>

        {server.skippedTools.length > 0 ? (
          <section aria-labelledby="skipped-title" className="rounded-card border border-border bg-warning-subtle p-5">
            <h2 id="skipped-title" className="flex items-center gap-2 text-[0.9375rem] font-semibold text-warning">
              <TriangleAlert aria-hidden className="size-4" /> Skipped tools
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              These tools are left out because their gateway name would not be valid.
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {server.skippedTools.map((name) => (
                <li key={name}>
                  <code className="font-mono text-[0.8125rem] break-all text-fg">{name}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Card title="Tools" description="The names clients and the chat use to call them.">
          <ToolList server={server} />
        </Card>
      </div>
    </>
  );
}
