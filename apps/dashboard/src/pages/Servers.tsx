import { Plus, Server } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageHeader } from '../components/ui/PageHeader';
import { ResponsiveTable, type Column } from '../components/ui/ResponsiveTable';
import { SkeletonList } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useServers, type ServerView } from '../features/servers/api';
import { ServerFormDialog } from '../features/servers/ServerFormDialog';
import { formatRelative } from '../lib/format';
import { useMe } from '../lib/auth';

function LastError({ error }: { error: string | null }) {
  if (!error) return <span className="text-fg-subtle">—</span>;
  return (
    <span title={error} className="block max-w-xs truncate text-fg-muted">
      {error}
    </span>
  );
}

export function Servers() {
  const { me } = useMe();
  const isAdmin = me?.role === 'admin';
  const navigate = useNavigate();
  const servers = useServers();
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  const detail = (s: ServerView) => `/servers/${s.id}`;
  const columns: Column<ServerView>[] = [
    {
      key: 'name',
      header: 'Server',
      cell: (s) => (
        <Link to={detail(s)} className="font-medium text-fg hover:underline">
          {s.name} <span className="ml-1 font-mono text-xs font-normal text-fg-subtle">{s.slug}</span>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
    { key: 'tools', header: 'Tools', align: 'right', cell: (s) => s.toolCount },
    { key: 'checked', header: 'Last checked', cell: (s) => <span className="text-fg-muted">{formatRelative(s.checkedAt)}</span> },
    { key: 'error', header: 'Last error', cell: (s) => <LastError error={s.lastError} /> },
  ];

  let body;
  if (servers.isPending) body = <SkeletonList rows={4} label="Loading servers" />;
  else if (servers.isError) {
    body = <ErrorState title="Servers didn’t load" error={servers.error} onRetry={() => void servers.refetch()} retrying={servers.isFetching} />;
  } else if (servers.data.length === 0) {
    body = (
      <EmptyState
        icon={<Server aria-hidden />}
        title="No servers yet"
        description={isAdmin ? 'Add an MCP server to start serving its tools through the gateway.' : 'An admin has not added any MCP servers yet.'}
        action={
          isAdmin ? (
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
              Add server
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <ResponsiveTable
        caption="MCP servers"
        columns={columns}
        rows={servers.data}
        rowKey={(s) => s.id}
        onRowClick={(s) => void navigate(detail(s))}
        renderCard={(s) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <Link to={detail(s)} className="min-w-0 font-medium text-fg hover:underline">
                {s.name} <span className="ml-1 font-mono text-xs font-normal text-fg-subtle">{s.slug}</span>
              </Link>
              <StatusBadge status={s.status} />
            </div>
            <p className="text-[0.8125rem] text-fg-muted">
              {s.toolCount} {s.toolCount === 1 ? 'tool' : 'tools'} · checked {formatRelative(s.checkedAt)}
            </p>
            {s.lastError ? <LastError error={s.lastError} /> : null}
          </div>
        )}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Servers"
        description="The MCP servers behind this gateway and the tools each one provides."
        actions={
          isAdmin ? (
            <Button ref={addRef} variant="primary" icon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
              Add server
            </Button>
          ) : undefined
        }
      />
      <div className="overflow-hidden rounded-card border border-border bg-surface">{body}</div>
      {isAdmin ? <ServerFormDialog open={adding} onOpenChange={setAdding} returnFocusTo={addRef} /> : null}
    </>
  );
}
