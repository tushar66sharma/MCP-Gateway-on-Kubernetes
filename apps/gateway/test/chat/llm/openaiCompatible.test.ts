import { describe, expect, it } from 'vitest';
import { createOpenAiCompatible } from '../../../src/chat/llm/openaiCompatible.js';
import { LlmError } from '../../../src/chat/llm/errors.js';
import type { LlmChatRequest } from '../../../src/chat/llm/types.js';

const NOW = 1_000_000;

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function setup(responses: Array<Response | Error>, opts: { maxRetries?: number } = {}) {
  const calls: Call[] = [];
  const delays: number[] = [];
  let i = 0;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return r.clone();
  }) as typeof fetch;
  const provider = createOpenAiCompatible(
    { name: 'groq', baseUrl: 'https://llm.test/v1', apiKey: 'test-key', model: 'm1', timeoutMs: 30000, maxRetries: opts.maxRetries ?? 2, extraBody: { reasoning_effort: 'low' } },
    {
      fetch: fetchFn,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
      now: () => NOW,
    },
  );
  return { provider, calls, delays };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const okBody = (message: Record<string, unknown>, usage?: Record<string, number>) => ({ choices: [{ message }], ...(usage ? { usage } : {}) });

function req(over: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'woo__list_orders', description: 'List orders', parameters: { type: 'object' } }],
    signal: new AbortController().signal,
    deadline: NOW + 60000,
    ...over,
  };
}

async function errorOf(p: Promise<unknown>): Promise<LlmError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(LlmError);
    return e as LlmError;
  }
  throw new Error('expected rejection');
}

describe('openai-compatible provider', () => {
  it('sends OpenAI tool format', async () => {
    const { provider, calls } = setup([json(okBody({ content: 'ok' }))]);
    await provider.chat(
      req({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'orders?' },
          { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'woo__list_orders', arguments: '{}' }] },
          { role: 'tool', content: '{"orders":[]}', toolCallId: 'c1' },
        ],
      }),
    );
    const c = calls[0]!;
    expect(c.url).toBe('https://llm.test/v1/chat/completions');
    expect(c.headers.Authorization).toBe('Bearer test-key');
    const b = c.body as {
      model: string;
      tool_choice: string;
      tools: Array<{ type: string; function: { name: string } }>;
      messages: Array<Record<string, unknown>>;
      temperature: number;
      max_completion_tokens: number;
      reasoning_effort: string;
    };
    expect(b.model).toBe('m1');
    expect(b.tool_choice).toBe('auto');
    expect(b.tools[0]!.type).toBe('function');
    expect(b.tools[0]!.function.name).toBe('woo__list_orders');
    expect(b.temperature).toBe(0.2);
    expect(b.max_completion_tokens).toBe(2048);
    expect(b.reasoning_effort).toBe('low');
    expect(b.messages[2]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'woo__list_orders', arguments: '{}' } }] });
    expect(b.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"orders":[]}' });
  });

  it('parses tool_calls and usage', async () => {
    const { provider } = setup([
      json(
        okBody(
          { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'woo__list_orders', arguments: '{"period":"today"}' } }] },
          { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        ),
      ),
    ]);
    const r = await provider.chat(req());
    expect(r.toolCalls[0]).toEqual({ id: 'c1', name: 'woo__list_orders', arguments: '{"period":"today"}' });
    expect(r.usage?.totalTokens).toBe(120);
    expect(r.provider).toBe('groq');
    expect(r.model).toBe('m1');
    expect(r.message.toolCalls).toEqual(r.toolCalls);
  });

  it('retries 429 honouring retry-after', async () => {
    const { provider, delays, calls } = setup([json({}, 429, { 'retry-after': '1' }), json(okBody({ content: 'ok' }))]);
    const r = await provider.chat(req());
    expect(r.message.content).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([1000]);
  });

  it('does not sleep past the deadline', async () => {
    const { provider, delays } = setup([json({}, 429, { 'retry-after': '50' })]);
    const err = await errorOf(provider.chat(req({ deadline: NOW + 20000 })));
    expect(err.code).toBe('LLM_RATE_LIMITED');
    expect(err.retryAfterSec).toBe(50);
    expect(delays).toEqual([]);
  });

  it('401 is LLM_AUTH_FAILED without retry', async () => {
    const { provider, calls } = setup([json({ error: { message: 'bad' } }, 401)]);
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_AUTH_FAILED');
    expect(calls).toHaveLength(1);
  });

  it('malformed JSON body is LLM_BAD_RESPONSE', async () => {
    const { provider } = setup([json('not json{')]);
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_BAD_RESPONSE');
  });

  it('missing choices is LLM_BAD_RESPONSE', async () => {
    const { provider } = setup([json({ choices: [] })]);
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_BAD_RESPONSE');
  });

  it('tool_calls without a string name or arguments are LLM_BAD_RESPONSE', async () => {
    const { provider } = setup([json(okBody({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x' } }] }))]);
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_BAD_RESPONSE');
  });

  it('retries tool_use_failed once', async () => {
    const { provider, calls } = setup([json({ error: { code: 'tool_use_failed' } }, 400)]);
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_BAD_RESPONSE');
    expect(calls).toHaveLength(2);
  });

  it('other 4xx is LLM_BAD_RESPONSE without retry', async () => {
    const { provider, calls } = setup([json({ error: { code: 'invalid_request' } }, 400)]);
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_BAD_RESPONSE');
    expect(calls).toHaveLength(1);
  });

  it('5xx exhausts retries to LLM_UNAVAILABLE', async () => {
    const { provider, calls, delays } = setup([json({}, 503)], { maxRetries: 2 });
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_UNAVAILABLE');
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('a network error is retried then LLM_UNAVAILABLE', async () => {
    const { provider, calls } = setup([new TypeError('fetch failed')], { maxRetries: 1 });
    expect((await errorOf(provider.chat(req()))).code).toBe('LLM_UNAVAILABLE');
    expect(calls).toHaveLength(2);
  });

  it('error message never contains the response body', async () => {
    const { provider } = setup([json('secret-echo', 500)]);
    const err = await errorOf(provider.chat(req()));
    expect(err.message).not.toContain('secret-echo');
    const p2 = setup([json({ error: { code: 'tool_use_failed', message: 'secret-echo' } }, 400)]).provider;
    expect((await errorOf(p2.chat(req()))).message).not.toContain('secret-echo');
  });

  it('stops retrying when the caller aborts', async () => {
    const ac = new AbortController();
    ac.abort();
    const { provider, calls } = setup([new DOMException('aborted', 'AbortError')]);
    const err = await errorOf(provider.chat(req({ signal: ac.signal })));
    expect(err.code).toBe('LLM_UNAVAILABLE');
    expect(calls).toHaveLength(1);
  });
});
