import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { MAX_HISTORY, MAX_MESSAGE_CHARS, postChat, toolCallsFromDetails, type AgentToolTrace, type StoppedReason, type WireMessage } from './api';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Assistant turns only. */
  toolCalls?: AgentToolTrace[];
  stoppedReason?: StoppedReason;
  /** User turns only: tool calls that ran before a failed reply to this turn (names and outcomes only). */
  ranBeforeError?: Array<Pick<AgentToolTrace, 'name' | 'outcome'>>;
}

/** Sent after a user turn that was never answered, so two user messages are never sent back to back. */
export const NO_REPLY_NOTE = '(no reply)';
/** What Retry asks for when tool calls already ran: resending the original request could repeat a write. */
export const CONTINUE_TEXT = 'Continue from where you stopped.';

/** A fixed note for the model: tool names and outcomes only, never arguments or results. */
export function ranNote(ran: NonNullable<ChatMessage['ranBeforeError']>): string {
  const list = ran.map((c) => `${c.name} ${c.outcome === 'success' ? 'succeeded' : 'failed'}`).join(', ');
  return `(The previous request failed after these actions already ran: ${list}. Do not repeat them unless asked.)`;
}

/**
 * The messages sent to the gateway (the stored thread is not changed). Empty messages are skipped (the
 * API rejects them). A user turn whose reply failed is followed by an assistant note: the tool calls that
 * already ran, or `(no reply)` when none did. When tool calls ran, the turn is continued rather than
 * repeated: Retry, and a reply that Retry produced, follow the note with CONTINUE_TEXT.
 */
export function toWire(thread: ChatMessage[]): WireMessage[] {
  const kept = thread.filter((m) => m.content.trim() !== '');
  const wire: WireMessage[] = [];
  kept.forEach((m, i) => {
    wire.push({ role: m.role, content: m.content });
    if (m.role !== 'user') return;
    const next = kept[i + 1];
    const ran = m.ranBeforeError ?? [];
    if (ran.length > 0) {
      wire.push({ role: 'assistant', content: ranNote(ran) });
      if (next?.role !== 'user') wire.push({ role: 'user', content: CONTINUE_TEXT });
    } else if (next?.role === 'user') {
      wire.push({ role: 'assistant', content: NO_REPLY_NOTE });
    }
  });
  // The gateway caps one message at 4000 characters; a longer earlier reply is cut so it can be sent back.
  return wire.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

export interface UseChat {
  messages: ChatMessage[];
  /** Adds the user's turn and asks for the reply. A no-op while a reply is pending or the text is blank. */
  send: (text: string) => Promise<void>;
  /**
   * Asks again for the last user turn after an error; the turn is not added twice. When tool calls already
   * ran, the request carries a note of them and asks the model to continue instead of starting over.
   */
  retry: () => Promise<void>;
  pending: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * The conversation lives in React state only (never browser storage): message text is private to the
 * session. Only `{role, content}` of the last 20 messages is sent (see toWire); the gateway rejects any
 * other field.
 */
export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nextId = useRef(1);
  // Latest history for retry/send without stale closures; `generation` voids a reply that arrives after reset.
  const history = useRef<ChatMessage[]>([]);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const commit = (next: ChatMessage[]) => {
    history.current = next;
    setMessages(next);
  };

  const run = useCallback(async () => {
    if (inFlight.current) return;
    const turn = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const wire = toWire(history.current);
    try {
      const out = await postChat(wire, controller.signal);
      if (turn !== generation.current) return;
      const reply: ChatMessage = {
        id: nextId.current++,
        role: 'assistant',
        content: out.reply,
        toolCalls: out.toolCalls,
        stoppedReason: out.stoppedReason,
      };
      commit([...history.current, reply]);
    } catch (err) {
      if (turn !== generation.current) return;
      // Remember what already ran on the unanswered user turn, so later requests tell the model about it.
      const ran = err instanceof ApiError ? toolCallsFromDetails(err.details) : [];
      const last = history.current.at(-1);
      if (ran.length > 0 && last?.role === 'user') {
        const ranBeforeError = [...(last.ranBeforeError ?? []), ...ran.map(({ name, outcome }) => ({ name, outcome }))];
        commit([...history.current.slice(0, -1), { ...last, ranBeforeError }]);
      }
      setError(err);
    } finally {
      if (turn === generation.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (content === '' || inFlight.current) return;
      commit([...history.current, { id: nextId.current++, role: 'user', content }]);
      await run();
    },
    [run],
  );

  const retry = useCallback(async () => {
    if (history.current.at(-1)?.role !== 'user') return;
    await run();
  }, [run]);

  const reset = useCallback(() => {
    generation.current++;
    abort.current?.abort();
    inFlight.current = false;
    history.current = [];
    setMessages([]);
    setPending(false);
    setError(null);
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  return { messages, send, retry, pending, error, reset };
}
