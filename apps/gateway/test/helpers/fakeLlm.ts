import type { ChatMessage, LlmChatRequest, LlmChatResult, LlmProvider, ToolCall, ToolSpec, Usage } from '../../src/chat/llm/types.js';

/** One scripted answer: a result, an error to throw, or a function of the request (it may wait). */
export type LlmStep = LlmChatResult | Error | ((r: LlmChatRequest) => LlmChatResult | Promise<LlmChatResult>);

/** What the fake saw for one chat() call: deep copies, so later pushes by the agent do not change them. */
export interface SeenRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  deadline: number;
  signal: AbortSignal;
  maxOutputTokens: number | undefined;
  temperature: number | undefined;
}

const USAGE: Usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

/** A provider that answers from a script, one step per chat() call; an exhausted script throws. */
export class ScriptedLlm implements LlmProvider {
  name = 'fake';
  model = 'fake-model';
  requests: SeenRequest[] = [];
  private steps: LlmStep[] = [];

  constructor(...steps: LlmStep[]) {
    this.steps = steps;
  }

  /** Replaces the script and forgets earlier requests. */
  script(...steps: LlmStep[]): this {
    this.steps = steps;
    this.requests = [];
    return this;
  }

  async chat(r: LlmChatRequest): Promise<LlmChatResult> {
    this.requests.push({ messages: structuredClone(r.messages), tools: structuredClone(r.tools), deadline: r.deadline, signal: r.signal, maxOutputTokens: r.maxOutputTokens, temperature: r.temperature });
    const step = this.steps.shift();
    if (step === undefined) throw new Error('ScriptedLlm: script exhausted');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(r);
    return step;
  }
}

/** An assistant response asking for tools. `args` is JSON-encoded; `raw` is sent as-is. */
export function toolStep(calls: Array<{ name: string; args?: unknown; raw?: string; id?: string }>, content: string | null = null): LlmChatResult {
  const toolCalls: ToolCall[] = calls.map((c, i) => ({ id: c.id ?? `call_${i + 1}`, name: c.name, arguments: c.raw ?? JSON.stringify(c.args ?? {}) }));
  return { message: { role: 'assistant', content, toolCalls }, toolCalls, usage: { ...USAGE }, provider: 'fake', model: 'fake-model' };
}

/** A final assistant answer (no tool calls). */
export function finalStep(content: string | null): LlmChatResult {
  return { message: { role: 'assistant', content }, toolCalls: [], usage: { ...USAGE }, provider: 'fake', model: 'fake-model' };
}
