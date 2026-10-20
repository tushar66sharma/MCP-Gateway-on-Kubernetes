import { clsx } from 'clsx';
import { Badge, type BadgeTone } from './Badge';

export type ServerStatus = 'connected' | 'unreachable' | 'disabled' | 'unknown';

const STATUS: Record<ServerStatus, { label: string; tone: BadgeTone; dot: string }> = {
  connected: { label: 'Connected', tone: 'success', dot: 'bg-success' },
  unreachable: { label: 'Unreachable', tone: 'danger', dot: 'bg-danger' },
  disabled: { label: 'Disabled', tone: 'neutral', dot: 'bg-neutral' },
  // Not checked yet: a hollow ring, so it never reads as "disabled".
  unknown: { label: 'Not checked yet', tone: 'neutral', dot: 'border-[1.5px] border-neutral bg-transparent' },
};

/** Server health. The colour dot always sits beside a text label (spec §7: colour is never the only signal). */
export function StatusBadge({ status, className }: { status: ServerStatus; className?: string }) {
  const s = STATUS[status] ?? STATUS.unknown;
  return (
    <Badge tone={s.tone} className={className}>
      <span aria-hidden className={clsx('size-2 rounded-full', s.dot, status === 'connected' && 'shadow-[0_0_0_3px_var(--success-subtle)]')} />
      {s.label}
    </Badge>
  );
}
