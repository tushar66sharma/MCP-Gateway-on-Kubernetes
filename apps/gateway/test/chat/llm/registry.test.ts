import { describe, expect, it } from 'vitest';
import { createLlmFromConfig, llmStatusOf, type LlmConfig } from '../../../src/chat/llm/registry.js';
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

describe('LLM registry', () => {
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
});
