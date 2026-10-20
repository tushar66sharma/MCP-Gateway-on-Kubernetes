import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_HISTORY, MAX_MESSAGE_CHARS, postChat, type AgentToolTrace, type StoppedReason } from './api';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Assistant turns only. */
  toolCalls?: AgentToolTrace[];
  stoppedReason?: StoppedReason;
}

export interface UseChat {
  messages: ChatMessage[];
  /** Adds the user's turn and asks for the reply. A no-op while a reply is pending or the text is blank. */
  send: (text: string) => Promise<void>;
  /** Asks again for the last user turn after an error; the turn is not added twice. */
  retry: () => Promise<void>;
  pending: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * The conversation lives in React state only (never browser storage): message text is private to the
 * session. Only `{role, content}` of the last 20 turns is sent; the gateway rejects any other field.
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
    // The gateway caps one message at 4000 characters; a longer earlier reply is cut so it can be sent back.
    const wire = history.current.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
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
