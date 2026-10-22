import { clsx } from 'clsx';
import { Info } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ToolCallTrace } from './ToolCallTrace';
import type { StoppedReason } from './api';
import type { ChatMessage } from './useChat';

const STOP_NOTE: Record<Exclude<StoppedReason, 'final'>, string> = {
  max_steps: 'The assistant reached its step limit before finishing, so this answer may be incomplete.',
  timeout: 'The assistant ran out of time before finishing, so this answer may be incomplete.',
};

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.role === 'user';
  const note = message.stoppedReason && message.stoppedReason !== 'final' ? STOP_NOTE[message.stoppedReason] : undefined;
  return (
    <li className={clsx('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <span className="mb-1 text-xs font-medium text-fg-subtle">{mine ? 'You' : 'Assistant'}</span>
      <div className={clsx('max-w-[min(100%,42rem)] min-w-0', !mine && 'w-full')}>
        {/* Plain text only: React escapes it and CSS keeps the line breaks. No HTML or markdown is ever rendered. */}
        <div
          className={clsx(
            'rounded-card px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap',
            mine ? 'bg-accent text-accent-fg' : 'border border-border bg-surface text-fg',
          )}
        >
          {message.content}
        </div>
        {message.toolCalls ? <ToolCallTrace calls={message.toolCalls} /> : null}
        {note ? (
          <p className="mt-2 flex items-start gap-1.5 text-[0.8125rem] text-fg-muted">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {note}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export interface ChatThreadProps {
  messages: ChatMessage[];
  pending: boolean;
}

export function ChatThread({ messages, pending }: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending]);

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label="Conversation" className="flex flex-col gap-4">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
      </ol>
      <p role="status" aria-live="polite" className="text-sm text-fg-muted">
        {pending ? 'Thinking… calling tools' : ''}
      </p>
      <div ref={endRef} />
    </div>
  );
}
