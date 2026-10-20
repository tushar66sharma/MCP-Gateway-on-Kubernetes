import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { ResponsiveTable, type Column } from '../../components/ui/ResponsiveTable';
import { formatDateTime, formatDuration, formatRelative } from '../../lib/format';
import type { AuditItem } from './api';

export const OUTCOME_TONE: Record<string, BadgeTone> = {
  success: 'success',
  error: 'danger',
  timeout: 'warning',
  denied: 'warning',
  unauthorized: 'danger',
};

const EVENT_LABEL: Record<string, string> = { tool_call: 'Tool call', auth_rejected: 'Auth rejected' };
const ERROR_MAX = 80;

function Source({ source }: { source: string }) {
  return source === 'chat' ? <Badge tone="accent">Chat</Badge> : <Badge>MCP client</Badge>;
}

function Outcome({ outcome }: { outcome: string }) {
  return <Badge tone={OUTCOME_TONE[outcome] ?? 'neutral'}>{outcome}</Badge>;
}

/** `server__tool`, the name a client sees; a rejected request has no tool. */
function toolLabel(item: AuditItem): string {
  if (!item.toolName) return '—';
  return item.serverSlug ? `${item.serverSlug}__${item.toolName}` : item.toolName;
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return <span className="text-fg-subtle">—</span>;
  const short = message.length > ERROR_MAX ? `${message.slice(0, ERROR_MAX)}…` : message;
  return (
    <span title={message} className="text-fg-muted">
      {short}
    </span>
  );
}

function When({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatRelative(at)} className="block">
      <span className="block text-fg">{formatDateTime(at)}</span>
      <span className="block text-xs text-fg-subtle">{formatRelative(at)}</span>
    </time>
  );
}

const columns: Array<Column<AuditItem>> = [
  { key: 'time', header: 'Time', cell: (r) => <When at={r.startedAt} />, className: 'whitespace-nowrap' },
  { key: 'user', header: 'User', cell: (r) => r.userEmail ?? '—' },
  { key: 'source', header: 'Source', cell: (r) => <Source source={r.source} /> },
  { key: 'event', header: 'Event', cell: (r) => EVENT_LABEL[r.event] ?? r.event },
  { key: 'server', header: 'Server', cell: (r) => r.serverSlug ?? '—' },
  { key: 'tool', header: 'Tool', cell: (r) => <span className="font-mono text-[0.8125rem]">{toolLabel(r)}</span> },
  { key: 'outcome', header: 'Outcome', cell: (r) => <Outcome outcome={r.outcome} /> },
  { key: 'duration', header: 'Duration', cell: (r) => formatDuration(r.durationMs), align: 'right', className: 'whitespace-nowrap' },
  { key: 'error', header: 'Error', cell: (r) => <ErrorText message={r.errorMessage} />, className: 'max-w-64' },
];

function AuditCard({ item }: { item: AuditItem }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-[0.8125rem] font-medium text-fg">{toolLabel(item)}</span>
        <Outcome outcome={item.outcome} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <Source source={item.source} />
        <span>{EVENT_LABEL[item.event] ?? item.event}</span>
        <span>{formatDuration(item.durationMs)}</span>
      </div>
      <p className="text-xs text-fg-subtle">
        {formatDateTime(item.startedAt)} ({formatRelative(item.startedAt)})
        {item.userEmail ? ` · ${item.userEmail}` : ''}
      </p>
      {item.errorMessage ? <ErrorText message={item.errorMessage} /> : null}
    </div>
  );
}

export function AuditTable({ items }: { items: AuditItem[] }) {
  return <ResponsiveTable caption="Audit log" columns={columns} rows={items} rowKey={(r) => r.id} renderCard={(r) => <AuditCard item={r} />} />;
}
