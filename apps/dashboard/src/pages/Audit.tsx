import { ScrollText } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/Skeleton';
import { errorMessage } from '../lib/api';
import { EMPTY_FILTERS, hasFilters, parseFilters, serializeFilters, useAuditLog, type AuditFilterValues } from '../features/audit/api';
import { AuditFilters } from '../features/audit/AuditFilters';
import { AuditTable } from '../features/audit/AuditTable';

export function Audit() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const setFilters = (next: AuditFilterValues) => setParams(serializeFilters(next), { replace: true });
  const log = useAuditLog(filters);
  const filtered = hasFilters(filters);

  const loadError: unknown = log.error;
  let body;
  if (log.isPending) body = <SkeletonList rows={6} label="Loading audit log" />;
  else if (log.isError) {
    body = <ErrorState title="The audit log didn’t load" error={log.error} onRetry={() => void log.refetch()} retrying={log.isFetching} />;
  } else {
    const items = log.data.pages.flatMap((p) => p.items);
    if (items.length === 0) {
      body = (
        <EmptyState
          icon={<ScrollText aria-hidden />}
          title={filtered ? 'No calls match these filters' : 'No tool calls yet'}
          description={
            filtered ? 'Widen the time range or remove a filter.' : 'Calls made through the gateway, from an MCP client or the chat, show up here.'
          }
          action={
            filtered ? (
              <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      );
    } else {
      body = (
        <>
          <AuditTable items={items} />
          {log.isFetchNextPageError ? (
            <p role="alert" className="border-t border-border px-5 py-3 text-sm text-danger">
              More calls didn’t load: {errorMessage(loadError)}
            </p>
          ) : null}
          {log.hasNextPage ? (
            <div className="flex justify-center border-t border-border p-4">
              <Button loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      );
    }
  }

  return (
    <>
      <PageHeader title="Audit log" description="Every tool call made through the gateway: who made it, and how it went." />
      <div className="mb-6 rounded-card border border-border bg-surface">
        <AuditFilters value={filters} onChange={setFilters} />
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface">{body}</div>
    </>
  );
}
