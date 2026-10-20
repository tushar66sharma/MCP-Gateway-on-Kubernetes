import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export interface ChatStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
}

/** What one tool call did, as the gateway reports it (`resultPreview` is already capped at 500 characters). */
export interface AgentToolTrace {
  name: string;
  arguments: unknown;
  outcome: 'success' | 'error';
  durationMs: number;
  resultPreview: string;
}

export type StoppedReason = 'final' | 'max_steps' | 'timeout';

export interface ChatReply {
  reply: string;
  toolCalls: AgentToolTrace[];
  stoppedReason: StoppedReason;
  provider: string;
  model: string;
}

/** The only fields the gateway accepts per message: never `system` or `tool`. */
export interface WireMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The gateway's limits (spec §6.9): 20 messages of 1-4000 characters. */
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_HISTORY = 20;

export const chatStatusKey = ['chat', 'status'] as const;

export function useChatStatus() {
  return useQuery({ queryKey: chatStatusKey, queryFn: ({ signal }) => apiFetch<ChatStatus>('/api/chat/status', { signal }) });
}

export const postChat = (messages: WireMessage[], signal?: AbortSignal) =>
  apiFetch<ChatReply>('/api/chat', { method: 'POST', body: { messages }, ...(signal && { signal }) });

function isTrace(value: unknown): value is AgentToolTrace {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return typeof t.name === 'string' && (t.outcome === 'success' || t.outcome === 'error') && typeof t.durationMs === 'number';
}

/** The tool calls that already ran before an error (`details.toolCalls`); empty when there are none. */
export function toolCallsFromDetails(details: Record<string, unknown> | undefined): AgentToolTrace[] {
  const raw = details?.toolCalls;
  return Array.isArray(raw)
    ? raw.filter(isTrace).map((t) => ({ ...t, resultPreview: typeof t.resultPreview === 'string' ? t.resultPreview : '' }))
    : [];
}
