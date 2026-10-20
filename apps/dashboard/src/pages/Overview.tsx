import { Card } from '../components/ui/Card';
import { buttonClasses } from '../components/ui/Button';
import { CopyField } from '../components/ui/CopyField';
import { ErrorState } from '../components/ui/ErrorState';
import { PageHeader } from '../components/ui/PageHeader';
import { Skeleton } from '../components/ui/Skeleton';
import { Link } from 'react-router';
import { RecentCalls } from '../features/audit/RecentCalls';
import { useServers, type ServerView } from '../features/servers/api';
import { formatNumber } from '../lib/format';

function Stat({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <dt className="text-[0.8125rem] font-medium text-fg-muted">{label}</dt>
      <dd className="mt-2 text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-fg tabular-nums">
        {loading ? <Skeleton className="h-7 w-12" /> : formatNumber(value)}
      </dd>
    </div>
  );
}

function counts(servers: ServerView[]) {
  return {
    connected: servers.filter((s) => s.status === 'connected').length,
    unreachable: servers.filter((s) => s.status === 'unreachable').length,
    disabled: servers.filter((s) => s.status === 'disabled').length,
    tools: servers.reduce((sum, s) => sum + s.toolCount, 0),
  };
}

export function Overview() {
  const servers = useServers();
  const loading = servers.isPending;
  const c = servers.data ? counts(servers.data) : { connected: 0, unreachable: 0, disabled: 0, tools: 0 };

  return (
    <>
      <PageHeader title="Overview" description="Server health, recent tool calls and how to connect an MCP client." />
      {servers.isError ? (
        <div className="mb-6 rounded-card border border-border bg-surface">
          <ErrorState title="Server status didn’t load" error={servers.error} onRetry={() => void servers.refetch()} retrying={servers.isFetching} />
        </div>
      ) : (
        <dl aria-label="Server summary" className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Servers connected" value={c.connected} loading={loading} />
          <Stat label="Servers unreachable" value={c.unreachable} loading={loading} />
          <Stat label="Servers disabled" value={c.disabled} loading={loading} />
          <Stat label="Tools available" value={c.tools} loading={loading} />
        </dl>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent calls" description="The latest tool calls through the gateway." flush>
          <RecentCalls />
        </Card>
        <Card title="Connect a client" description="Point an MCP client such as Claude Code or Cursor at the gateway.">
          <div className="flex flex-col gap-5">
            <CopyField label="MCP endpoint" value={`${window.location.origin}/mcp`} />
            <p className="text-sm text-fg-muted">Clients authenticate with an API key sent as a Bearer token.</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/keys" className={buttonClasses('primary')}>
                Create an API key
              </Link>
              <Link to="/chat" className={buttonClasses('secondary')}>
                Try the chat
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
