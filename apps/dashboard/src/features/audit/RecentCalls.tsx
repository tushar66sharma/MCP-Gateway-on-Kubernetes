import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { apiFetch } from '../../lib/api';
import { formatDuration, formatRelative } from '../../lib/format';

export interface AuditItem {
  id: string;
  event: string;
  source: string;
  userId: string | null;
  userEmail: string | null;
  serverSlug: string | null;
  toolName: string | null;
  startedAt: string;
  durationMs: number;
  outcome: string;
  errorMessage: string | null;
}

const OUTCOME_TONE: Record<string, BadgeTone> = { success: 'success', error: 'danger', timeout: 'warning', denied: 'warning', unauthorized: 'danger' };

/** The five newest tool calls: every call for an admin, the member's own for a member (the API decides). */
export function RecentCalls() {
  const query = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: ({ signal }) => apiFetch<{ items: AuditItem[]; nextCursor: string | null }>('/api/audit?limit=5', { signal }),
  });

  if (query.isPending) return <SkeletonList rows={3} label="Loading recent calls" />;
  if (query.isError) {
    return <ErrorState title="Recent calls didn’t load" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  const items = query.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText aria-hidden />}
        title="No tool calls yet"
        description="Calls made through the gateway, from an MCP client or the chat, show up here."
      />
    );
  }
  return (
    <>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-[0.8125rem] font-medium text-fg">{item.toolName ?? item.event}</p>
              <p className="text-xs text-fg-subtle">
                {item.serverSlug ? `${item.serverSlug} · ` : ''}
                {formatRelative(item.startedAt)} · {formatDuration(item.durationMs)}
              </p>
            </div>
            <Badge tone={OUTCOME_TONE[item.outcome] ?? 'neutral'}>{item.outcome}</Badge>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-5 py-3 text-sm">
        <Link to="/audit" className="font-medium text-accent-text hover:underline">
          View the audit log
        </Link>
      </div>
    </>
  );
}
