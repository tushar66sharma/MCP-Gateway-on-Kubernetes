import { LlmError } from './errors.js';
import type { ChatMessage, LlmChatRequest, LlmChatResult, LlmProvider, ToolCall, Usage } from './types.js';

export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface LlmRuntime {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const MAX_RETRY_AFTER_SEC = 20;

/** Resolves after ms; rejects as soon as the signal aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content ?? '' };
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    };
  }
  return { role: m.role, content: m.content ?? '' };
}

function parseToolCalls(raw: unknown): ToolCall[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: ToolCall[] = [];
  for (const [i, entry] of raw.entries()) {
    const fn = isRecord(entry) ? entry.function : undefined;
    if (!isRecord(entry) || !isRecord(fn) || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') return null;
    out.push({ id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : `call_${i}`, name: fn.name, arguments: fn.arguments });
  }
  return out;
}

function parseUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) return undefined;
  const { prompt_tokens: p, completion_tokens: c, total_tokens: t } = raw;
  if (typeof p !== 'number' || typeof c !== 'number') return undefined;
  return { promptTokens: p, completionTokens: c, totalTokens: typeof t === 'number' ? t : p + c };
}

/** The provider's error.code, only when it looks like a plain identifier (never free text). */
function errorCodeOf(text: string): string | undefined {
  try {
    const body: unknown = JSON.parse(text);
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
    return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function retryAfterOf(res: Response): number | undefined {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? Math.ceil(v) : undefined;
}

/** Reads an error body for its error.code only; a body that cannot be read is treated as empty. */
async function readBodySafely(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    try {
      await res.body?.cancel();
    } catch {
      // nothing more to release
    }
    return '';
  }
}

type Attempt = { result: LlmChatResult } | { error: LlmError; retryable: boolean; toolUseFailed?: boolean };

export function createOpenAiCompatible(opts: OpenAiCompatibleOptions, rt: LlmRuntime = {}): LlmProvider {
  const fetchFn = rt.fetch ?? fetch;
  const sleep = rt.sleep ?? abortableSleep;
  const random = rt.random ?? Math.random;
  const now = rt.now ?? Date.now;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const fail = (code: LlmError['code'], message: string, extra: { retryAfterSec?: number; httpStatus?: number; providerCode?: string } = {}): LlmError =>
    new LlmError(code, message, { provider: opts.name, ...extra });
  const badResponse = (): LlmError => fail('LLM_BAD_RESPONSE', 'The language model returned a response that could not be used.');

  function parseSuccess(text: string): Attempt {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { error: badResponse(), retryable: false };
    }
    const choices = isRecord(json) ? json.choices : undefined;
    const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const msg = isRecord(first) ? first.message : undefined;
    const toolCalls = isRecord(msg) ? parseToolCalls(msg.tool_calls) : null;
    if (!isRecord(msg) || toolCalls === null) return { error: badResponse(), retryable: false };
    const usage = parseUsage(isRecord(json) ? json.usage : undefined);
    const message: ChatMessage = {
      role: 'assistant',
      content: typeof msg.content === 'string' ? msg.content : null,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
    return { result: { message, toolCalls, ...(usage ? { usage } : {}), provider: opts.name, model: opts.model } };
  }

  async function attemptOnce(r: LlmChatRequest, headers: Record<string, string>, body: string): Promise<Attempt> {
    let res: Response;
    try {
      res = await fetchFn(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.any([r.signal, AbortSignal.timeout(opts.timeoutMs)]) });
    } catch {
      if (r.signal.aborted) return { error: fail('LLM_UNAVAILABLE', 'The request was cancelled.'), retryable: false };
      return { error: fail('LLM_UNAVAILABLE', 'The language model provider could not be reached.'), retryable: true };
    }
    const status = res.status;
    if (!res.ok) {
      // Only the status and a validated error.code are kept; the body can echo request content.
      const providerCode = errorCodeOf(await readBodySafely(res));
      const info = { httpStatus: status, ...(providerCode !== undefined ? { providerCode } : {}) };
      if (status === 401 || status === 403) return { error: fail('LLM_AUTH_FAILED', 'The language model provider rejected the API key.', info), retryable: false };
      if (status === 429) {
        const after = retryAfterOf(res);
        return { error: fail('LLM_RATE_LIMITED', 'The language model provider is rate limiting requests.', { ...info, ...(after !== undefined ? { retryAfterSec: after } : {}) }), retryable: true };
      }
      if (status >= 500) return { error: fail('LLM_UNAVAILABLE', 'The language model provider is unavailable.', info), retryable: true };
      return { error: fail('LLM_BAD_RESPONSE', 'The language model returned a response that could not be used.', info), retryable: false, toolUseFailed: status === 400 && providerCode === 'tool_use_failed' };
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      return { error: fail('LLM_UNAVAILABLE', 'The language model provider could not be reached.'), retryable: !r.signal.aborted };
    }
    return parseSuccess(text);
  }

  async function chat(r: LlmChatRequest): Promise<LlmChatResult> {
    const body = JSON.stringify({
      model: opts.model,
      messages: r.messages.map(toWireMessage),
      tools: r.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto',
      temperature: 0.2,
      max_completion_tokens: 2048,
      ...opts.extraBody,
    });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}`, ...opts.extraHeaders };
    let toolUseRetried = false;

    for (let attempt = 0; ; attempt++) {
      const out = await attemptOnce(r, headers, body);
      if ('result' in out) return out.result;
      const retry = out.retryable || (out.toolUseFailed === true && !toolUseRetried);
      if (out.toolUseFailed) toolUseRetried = true;
      if (!retry || attempt >= opts.maxRetries) throw out.error;

      const after = out.error.retryAfterSec;
      const delay = after !== undefined ? Math.min(after, MAX_RETRY_AFTER_SEC) * 1000 : 500 * 2 ** attempt + random() * 250;
      // Waiting would leave no time for the call itself: report the failure now.
      if (now() + delay >= r.deadline) throw out.error;
      try {
        await sleep(delay, r.signal);
      } catch {
        throw fail('LLM_UNAVAILABLE', 'The request was cancelled.');
      }
    }
  }

  return { name: opts.name, model: opts.model, chat };
}
