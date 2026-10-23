import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../lib/api';

export interface ChatStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
  topicCheck: boolean;
  /** Today's token budget for this user; null when the budget is unlimited. */
  budget: ChatBudget | null;
}

export interface ChatBudget {
  limit: number;
  used: number;
  remaining: number;
  /** ISO time of the next reset. */
  resetsAt: string;
}

/** What one tool call did, as the gateway reports it (`resultPreview` is already capped at 500 characters). */
export interface AgentToolTrace {
  name: string;
  arguments: unknown;
  outcome: 'success' | 'error';
  durationMs: number;
  resultPreview: string;
}

export type StoppedReason = 'final' | 'max_steps' | 'timeout' | 'off_topic';

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

export const BUDGET_EXCEEDED = 'CHAT_BUDGET_EXCEEDED';

/** `Today: 1,234 / 50,000 tokens` */
export const budgetLine = (b: ChatBudget) => `Today: ${b.used.toLocaleString('en-US')} / ${b.limit.toLocaleString('en-US')} tokens`;

/** The reset time as a timestamp, from a CHAT_BUDGET_EXCEEDED error's `details.resetsAt`; null for any other error. */
export function budgetResetAt(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== BUDGET_EXCEEDED) return null;
  const raw = error.details?.resetsAt;
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
}

export const formatResetTime = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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
