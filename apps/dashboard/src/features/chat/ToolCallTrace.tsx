import { ChevronRight } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { formatDuration, plural } from '../../lib/format';
import type { AgentToolTrace } from './api';

function prettyArguments(args: unknown): string {
  if (args === undefined) return '{}';
  try {
    return JSON.stringify(args, null, 2) ?? '{}';
  } catch {
    return String(args);
  }
}

export interface ToolCallTraceProps {
  calls: AgentToolTrace[];
  /** Expanded from the start (the error alert shows what already ran). */
  defaultOpen?: boolean;
}

/** The tools an assistant turn called: collapsed to a count, expandable to arguments and a result preview. */
export function ToolCallTrace({ calls, defaultOpen = false }: ToolCallTraceProps) {
  if (calls.length === 0) return null;
  return (
    <details open={defaultOpen || undefined} className="group mt-2 rounded-control border border-border bg-surface-sunken">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[0.8125rem] font-medium text-fg-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90" />
        {plural(calls.length, 'tool call')}
      </summary>
      <ol className="divide-y divide-border border-t border-border">
        {calls.map((call, i) => (
          <li key={i} className="flex flex-col gap-2 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-all font-mono text-[0.8125rem] font-medium text-fg">{call.name}</span>
              <Badge tone={call.outcome === 'success' ? 'success' : 'danger'}>{call.outcome === 'success' ? 'Succeeded' : 'Failed'}</Badge>
              <span className="text-xs text-fg-subtle">{formatDuration(call.durationMs)}</span>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-fg-subtle">Arguments</p>
              <pre className="max-h-48 overflow-auto rounded-control bg-surface p-2 font-mono text-xs whitespace-pre-wrap break-all text-fg">
                {prettyArguments(call.arguments)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-fg-subtle">Result</p>
              <pre className="max-h-48 overflow-auto rounded-control bg-surface p-2 font-mono text-xs whitespace-pre-wrap break-all text-fg">
                {call.resultPreview === '' ? '(empty)' : call.resultPreview}
              </pre>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
