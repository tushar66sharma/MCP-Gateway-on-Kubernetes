import { describe, expect, it, vi } from 'vitest';
import { createLlmFromConfig, createTopicCheckLlm, TOPIC_CHECK_MAX_OUTPUT_TOKENS, llmStatusOf, type LlmConfig } from '../../../src/chat/llm/registry.js';
import { LlmError } from '../../../src/chat/llm/errors.js';

const BASE: LlmConfig = {
  LLM_PROVIDER: 'groq',
  LLM_MODEL: '',
  LLM_BASE_URL: '',
  LLM_FALLBACK_PROVIDER: 'openrouter',
  LLM_FALLBACK_MODEL: '',
  GROQ_API_KEY: 'groq-secret-key',
  OPENROUTER_API_KEY: 'or-secret-key',
  LLM_TIMEOUT_MS: 30000,
  LLM_MAX_RETRIES: 0,
  LLM_MAX_OUTPUT_TOKENS: 1024,
  CHAT_TOPIC_CHECK: true,
  CHAT_TOPIC_CHECK_MODEL: '',
  CHAT_TOPIC_CHECK_TIMEOUT_MS: 5000,
};

const okResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: 'from fallback' } }] }), { status: 200 });

function fakeFetch(handler: (url: string) => Response) {
  const urls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return handler(String(url));
  }) as typeof fetch;
  return { f, urls };
}

const request = () => ({ messages: [{ role: 'user' as const, content: 'hi' }], tools: [], signal: new AbortController().signal, deadline: Date.now() + 60000 });

describe('createTopicCheckLlm', () => {
  it('uses the topic model, no retries and the short timeout', async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 503 });
    }) as typeof fetch;
    const llm = createTopicCheckLlm({ ...BASE, LLM_MAX_RETRIES: 2, LLM_TIMEOUT_MS: 30000 }, { fetch: f, sleep: async () => {}, random: () => 0 })!;
    expect(llm.name).toBe('groq');
    expect(llm.model).toBe('openai/gpt-oss-20b');
    await expect(llm.chat({ ...request(), maxOutputTokens: TOPIC_CHECK_MAX_OUTPUT_TOKENS })).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    expect(seen).toHaveLength(1); // no retry, no fallback
    expect(seen[0]!.url).toContain('groq');
    expect(seen[0]!.body.model).toBe('openai/gpt-oss-20b');
    expect(seen[0]!.body.reasoning_effort).toBe('low');
    expect(seen[0]!.body.max_completion_tokens).toBe(64);
    expect(TOPIC_CHECK_MAX_OUTPUT_TOKENS).toBe(64);
  });

  it('uses the short timeout, not LLM_TIMEOUT_MS', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const f = (async () => okResponse()) as typeof fetch;
    await createTopicCheckLlm({ ...BASE, LLM_TIMEOUT_MS: 30000, CHAT_TOPIC_CHECK_TIMEOUT_MS: 1234 }, { fetch: f })!.chat(request());
    expect(spy).toHaveBeenCalledWith(1234);
    spy.mockRestore();
  });

  it('honours CHAT_TOPIC_CHECK_MODEL and uses the main model for openrouter', () => {
    expect(createTopicCheckLlm({ ...BASE, CHAT_TOPIC_CHECK_MODEL: 'custom/model' })!.model).toBe('custom/model');
    const or = createTopicCheckLlm({ ...BASE, LLM_PROVIDER: 'openrouter', LLM_MODEL: 'main/model', LLM_FALLBACK_PROVIDER: 'groq' })!;
    expect(or.name).toBe('openrouter');
    expect(or.model).toBe('main/model');
  });

  it('returns null when CHAT_TOPIC_CHECK is false or the primary has no key', () => {
    expect(createTopicCheckLlm({ ...BASE, CHAT_TOPIC_CHECK: false })).toBeNull();
    expect(createTopicCheckLlm({ ...BASE, GROQ_API_KEY: '' })).toBeNull();
  });
});

describe('LLM registry', () => {
  it('applies LLM_MAX_OUTPUT_TOKENS to main-model calls', async () => {
    let body: Record<string, unknown> = {};
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return okResponse();
    }) as typeof fetch;
    await createLlmFromConfig({ ...BASE, LLM_MAX_OUTPUT_TOKENS: 300 }, { fetch: f })!.chat(request());
    expect(body.max_completion_tokens).toBe(300);
  });

  it('returns null without a primary key', () => {
    expect(createLlmFromConfig({ ...BASE, GROQ_API_KEY: '' })).toBeNull();
  });

  it('uses fallback after primary is rate limited', async () => {
    const { f, urls } = fakeFetch((u) => (u.includes('groq') ? new Response('{}', { status: 429 }) : okResponse()));
    const llm = createLlmFromConfig(BASE, { fetch: f, sleep: async () => {}, random: () => 0 })!;
    const r = await llm.chat(request());
    expect(r.provider).toBe('openrouter');
    expect(r.message.content).toBe('from fallback');
    expect(urls.filter((u) => u.includes('openrouter'))).toHaveLength(1);
  });

  it('uses the fallback at once when the primary asks for a long wait', async () => {
    const { f, urls } = fakeFetch((u) => (u.includes('groq') ? new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }) : okResponse()));
    const delays: number[] = [];
    const llm = createLlmFromConfig({ ...BASE, LLM_MAX_RETRIES: 2 }, { fetch: f, sleep: async (ms) => void delays.push(ms), random: () => 0 })!;
    const r = await llm.chat(request());
    expect(r.provider).toBe('openrouter');
    expect(delays).toEqual([]);
    expect(urls.filter((u) => u.includes('groq'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('openrouter'))).toHaveLength(1);
  });

  it('no fallback on auth failure', async () => {
    const { f, urls } = fakeFetch(() => new Response('{}', { status: 401 }));
    const llm = createLlmFromConfig(BASE, { fetch: f, sleep: async () => {} })!;
    await expect(llm.chat(request())).rejects.toMatchObject({ code: 'LLM_AUTH_FAILED' });
    expect(urls.some((u) => u.includes('openrouter'))).toBe(false);
  });

  it('rethrows the primary error when the fallback has no key', async () => {
    const { f } = fakeFetch(() => new Response('{}', { status: 503 }));
    const llm = createLlmFromConfig({ ...BASE, OPENROUTER_API_KEY: '' }, { fetch: f, sleep: async () => {} })!;
    const err = await llm.chat(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe('LLM_UNAVAILABLE');
  });

  it('llmStatusOf never includes keys', () => {
    const status = llmStatusOf(BASE);
    expect(JSON.stringify(status)).not.toContain('secret-key');
    expect(status).toEqual({ configured: true, provider: 'groq', model: expect.any(String), fallbackProvider: 'openrouter' });
    expect(llmStatusOf({ ...BASE, GROQ_API_KEY: '', LLM_FALLBACK_PROVIDER: '' }).configured).toBe(false);
  });

  it('sends reasoning_effort only for gpt-oss models', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return okResponse();
    }) as typeof fetch;
    for (const model of ['llama-3.1-8b-instant', 'openai/gpt-oss-120b', '']) {
      await createLlmFromConfig({ ...BASE, LLM_MODEL: model, LLM_FALLBACK_PROVIDER: '' }, { fetch: f })!.chat(request());
    }
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1]).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low' });
    expect(bodies[2]).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low' });
  });

  it('makes exactly one fallback request even with retries configured, and reports its code', async () => {
    const { f, urls } = fakeFetch((u) => new Response('{}', { status: u.includes('groq') ? 429 : 503 }));
    const llm = createLlmFromConfig({ ...BASE, LLM_MAX_RETRIES: 2 }, { fetch: f, sleep: async () => {}, random: () => 0 })!;
    const err = (await llm.chat(request()).catch((e: unknown) => e)) as LlmError;
    expect(err.code).toBe('LLM_RATE_LIMITED');
    expect(err.fallbackProvider).toBe('openrouter');
    expect(err.fallbackCode).toBe('LLM_UNAVAILABLE');
    expect(urls.filter((u) => u.includes('groq'))).toHaveLength(3);
    expect(urls.filter((u) => u.includes('openrouter'))).toHaveLength(1);
  });
});
