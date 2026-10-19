import { LlmError } from './llm/errors.js';
import type { ChatMessage, LlmChatResult, LlmProvider, ToolCall, ToolSpec, Usage } from './llm/types.js';
import type { McpToolClient } from './mcpLoopback.js';
import { buildSystemPrompt } from './systemPrompt.js';

/** Spec §6.9 / §6.10 limits on what goes back to the model and to the client. */
export const TOOL_RESULT_MAX_CHARS = 6000;
export const RESULT_PREVIEW_MAX_CHARS = 500;
export const TOOL_DESCRIPTION_MAX_CHARS = 300;
/** An argument string the model sent that is not valid JSON is shown in the trace up to this length. */
const RAW_ARGUMENTS_MAX_CHARS = 500;

export const TIMEOUT_REPLY = 'This took too long and was stopped. The actions listed below already ran.';
export const maxStepsReply = (n: number): string => `I stopped after ${n} tool steps without a final answer. Try a narrower question.`;

export interface AgentToolTrace {
  name: string;
  arguments: unknown;
  outcome: 'success' | 'error';
  durationMs: number;
  resultPreview: string;
}

export interface AgentTurnResult {
  reply: string;
  toolCalls: AgentToolTrace[];
  stoppedReason: 'final' | 'max_steps' | 'timeout';
  usage: Usage;
  provider: string;
  model: string;
  /** LLM responses with tool calls that were executed (for the turn log line). */
  steps: number;
}

/** An LLM failure part-way through a turn, with the tool calls that had already run (they are not undone). */
export class AgentLlmError extends Error {
  readonly llmError: LlmError;
  readonly toolCalls: AgentToolTrace[];
  readonly steps: number;
  /** Token usage of the responses before the failure. */
  readonly usage: Usage;

  constructor(llmError: LlmError, toolCalls: AgentToolTrace[], steps: number, usage: Usage) {
    super(llmError.message);
    this.name = 'AgentLlmError';
    this.llmError = llmError;
    this.toolCalls = toolCalls;
    this.steps = steps;
    this.usage = usage;
  }
}

export interface AgentTurnOptions {
  history: ChatMessage[];
  llm: LlmProvider;
  mcp: McpToolClient;
  now: Date;
  storeTimeZone: string;
  /** For the system prompt (by addition to the plan's interface: the prompt names the user). */
  userName: string;
  maxSteps: number;
  signal: AbortSignal;
  /** Epoch ms. */
  deadline: number;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The tool name as an attribute value: the model can send any string, so only [A-Za-z0-9_-] is kept. */
const safeName = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

/** A result may not open or close a `<tool_result>` block of its own (it is untrusted text). */
const neutralise = (text: string): string => text.replace(/<(\/?)tool_result/gi, '<$1tool-result');

export function wrapToolResult(name: string, text: string): string {
  return `<tool_result name="${safeName(name)}">\n${truncate(neutralise(text), TOOL_RESULT_MAX_CHARS)}\n</tool_result>`;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The model's arguments as a JSON object; an empty string means no arguments. */
function parseArguments(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (raw.trim() === '') return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(raw);
    return isPlainObject(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Resolves with `p`, or rejects as soon as `signal` aborts (the abandoned promise is left to settle). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * One chat turn (spec §6.9): list the tools once, then ask the model; every response with tool calls is
 * one step, its calls run one by one through the loopback client and their results go back wrapped as
 * untrusted data. Ends on a response without tool calls (`final`), on a response that still wants tools
 * after `maxSteps` steps (`max_steps`), or when the deadline passes or `signal` aborts (`timeout`, with
 * the traces so far). An LLM failure is rethrown as AgentLlmError carrying the traces.
 */
export async function runAgentTurn(o: AgentTurnOptions): Promise<AgentTurnResult> {
  const traces: AgentToolTrace[] = [];
  const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let provider = o.llm.name;
  let model = o.llm.model;
  let steps = 0;

  const expired = (): boolean => o.signal.aborted || Date.now() >= o.deadline;
  const result = (reply: string, stoppedReason: AgentTurnResult['stoppedReason']): AgentTurnResult => ({
    reply,
    toolCalls: traces,
    stoppedReason,
    usage,
    provider,
    model,
    steps,
  });
  const timedOut = (): AgentTurnResult => result(TIMEOUT_REPLY, 'timeout');

  if (expired()) return timedOut();
  let tools: ToolSpec[];
  try {
    tools = (await untilAborted(o.mcp.listTools(), o.signal)).map((t) => ({ ...t, description: truncate(t.description, TOOL_DESCRIPTION_MAX_CHARS) }));
  } catch (err) {
    if (expired()) return timedOut();
    throw err;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt({ now: o.now, storeTimeZone: o.storeTimeZone, userName: o.userName }) },
    ...o.history,
  ];

  for (;;) {
    if (expired()) return timedOut();
    let res: LlmChatResult;
    try {
      res = await o.llm.chat({ messages, tools, signal: o.signal, deadline: o.deadline });
    } catch (err) {
      // A provider cut off by the turn signal reports a cancellation; the turn reports the timeout.
      if (expired()) return timedOut();
      if (err instanceof LlmError) throw new AgentLlmError(err, traces, steps, usage);
      throw err;
    }
    provider = res.provider;
    model = res.model;
    if (res.usage) {
      usage.promptTokens += res.usage.promptTokens;
      usage.completionTokens += res.usage.completionTokens;
      usage.totalTokens += res.usage.totalTokens;
    }

    if (res.toolCalls.length === 0) return result((res.message.content ?? '').trim(), 'final');
    if (steps >= o.maxSteps) return result(maxStepsReply(o.maxSteps), 'max_steps');
    steps += 1;

    messages.push({ role: 'assistant', content: res.message.content, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      if (expired()) return timedOut();
      const { trace, text } = await runToolCall(o.mcp, call, o.signal);
      traces.push(trace);
      if (text === null) return timedOut();
      messages.push({ role: 'tool', toolCallId: call.id, content: wrapToolResult(call.name, text) });
    }
  }
}

/** One tool call. `text` is null when the turn was aborted while the call was running. */
async function runToolCall(mcp: McpToolClient, call: ToolCall, signal: AbortSignal): Promise<{ trace: AgentToolTrace; text: string | null }> {
  const started = Date.now();
  const trace = (args: unknown, outcome: AgentToolTrace['outcome'], text: string): AgentToolTrace => ({
    name: call.name,
    arguments: args,
    outcome,
    durationMs: Date.now() - started,
    resultPreview: truncate(text, RESULT_PREVIEW_MAX_CHARS),
  });

  const parsed = parseArguments(call.arguments);
  if (!parsed.ok) {
    const text = `Invalid JSON arguments for ${call.name}`;
    return { trace: trace(truncate(call.arguments, RAW_ARGUMENTS_MAX_CHARS), 'error', text), text };
  }
  try {
    const r = await mcp.callTool(call.name, parsed.value, signal);
    return { trace: trace(parsed.value, r.isError ? 'error' : 'success', r.text), text: r.text };
  } catch {
    // The call may still have run upstream: it stays in the trace.
    if (signal.aborted) return { trace: trace(parsed.value, 'error', 'Stopped: the turn timed out while this tool was running.'), text: null };
    const text = 'The tool call failed before a result was returned.';
    return { trace: trace(parsed.value, 'error', text), text };
  }
}
