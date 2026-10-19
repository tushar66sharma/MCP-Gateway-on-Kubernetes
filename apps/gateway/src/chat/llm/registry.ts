import { LlmError } from './errors.js';
import { createOpenAiCompatible, type LlmRuntime } from './openaiCompatible.js';
import { PROVIDERS, type ProviderId } from './providers.js';
import type { LlmChatRequest, LlmChatResult, LlmProvider } from './types.js';

export type { LlmRuntime } from './openaiCompatible.js';

export interface LlmConfig {
  LLM_PROVIDER: ProviderId;
  LLM_MODEL: string;
  LLM_BASE_URL: string;
  LLM_FALLBACK_PROVIDER: ProviderId | '';
  LLM_FALLBACK_MODEL: string;
  GROQ_API_KEY: string;
  OPENROUTER_API_KEY: string;
  LLM_TIMEOUT_MS: number;
  LLM_MAX_RETRIES: number;
}

const keyOf = (c: LlmConfig, id: ProviderId): string => c[PROVIDERS[id].apiKeyEnv];

function build(c: LlmConfig, id: ProviderId, model: string, baseUrl: string, maxRetries: number, rt: LlmRuntime): LlmProvider {
  const def = PROVIDERS[id];
  return createOpenAiCompatible(
    {
      name: id,
      baseUrl: baseUrl || def.baseUrl,
      apiKey: keyOf(c, id),
      model: model || def.defaultModel,
      timeoutMs: c.LLM_TIMEOUT_MS,
      maxRetries,
      ...(def.extraHeaders ? { extraHeaders: def.extraHeaders } : {}),
      ...(def.extraBody ? { extraBody: def.extraBody } : {}),
    },
    rt,
  );
}

/** The primary provider with an optional one-shot fallback; null when the primary has no key. */
export function createLlmFromConfig(c: LlmConfig, rt: LlmRuntime = {}): LlmProvider | null {
  if (keyOf(c, c.LLM_PROVIDER) === '') return null;
  const primary = build(c, c.LLM_PROVIDER, c.LLM_MODEL, c.LLM_BASE_URL, c.LLM_MAX_RETRIES, rt);
  const fb = c.LLM_FALLBACK_PROVIDER;
  if (fb === '' || fb === c.LLM_PROVIDER || keyOf(c, fb) === '') return primary;
  // The fallback is tried once, with no retries.
  const fallback = build(c, fb, c.LLM_FALLBACK_MODEL, '', 0, rt);

  return {
    name: primary.name,
    model: primary.model,
    async chat(r: LlmChatRequest): Promise<LlmChatResult> {
      try {
        return await primary.chat(r);
      } catch (err) {
        const eligible = err instanceof LlmError && (err.code === 'LLM_RATE_LIMITED' || err.code === 'LLM_UNAVAILABLE');
        if (!eligible || r.signal.aborted) throw err;
        try {
          return await fallback.chat(r);
        } catch {
          // Report the primary's failure (it carries retryAfterSec when the provider gave one).
          throw err;
        }
      }
    },
  };
}

export function llmStatusOf(c: LlmConfig): { configured: boolean; provider: ProviderId; model: string; fallbackProvider: ProviderId | null } {
  return {
    configured: keyOf(c, c.LLM_PROVIDER) !== '',
    provider: c.LLM_PROVIDER,
    model: c.LLM_MODEL || PROVIDERS[c.LLM_PROVIDER].defaultModel,
    fallbackProvider: c.LLM_FALLBACK_PROVIDER === '' ? null : c.LLM_FALLBACK_PROVIDER,
  };
}
