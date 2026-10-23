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
  LLM_MAX_OUTPUT_TOKENS: number;
  CHAT_TOPIC_CHECK: boolean;
  CHAT_TOPIC_CHECK_MODEL: string;
  CHAT_TOPIC_CHECK_TIMEOUT_MS: number;
}

/** Output cap for the topic-check call: gpt-oss models spend output tokens on reasoning, so 8 is too small. */
export const TOPIC_CHECK_MAX_OUTPUT_TOKENS = 64;

const keyOf = (c: LlmConfig, id: ProviderId): string => c[PROVIDERS[id].apiKeyEnv];

function build(c: LlmConfig, id: ProviderId, model: string, baseUrl: string, maxRetries: number, timeoutMs: number, rt: LlmRuntime): LlmProvider {
  const def = PROVIDERS[id];
  const resolvedModel = model || def.defaultModel;
  const extraBody = {
    ...def.extraBody,
    ...def.modelExtraBody?.filter((m) => m.match.test(resolvedModel)).reduce<Record<string, unknown>>((acc, m) => ({ ...acc, ...m.body }), {}),
  };
  return createOpenAiCompatible(
    {
      name: id,
      baseUrl: baseUrl || def.baseUrl,
      apiKey: keyOf(c, id),
      model: resolvedModel,
      timeoutMs,
      maxRetries,
      maxTokensParam: def.maxTokensParam,
      defaultMaxOutputTokens: c.LLM_MAX_OUTPUT_TOKENS,
      ...(def.extraHeaders ? { extraHeaders: def.extraHeaders } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
    },
    rt,
  );
}

/** The primary provider with an optional one-shot fallback; null when the primary has no key. */
export function createLlmFromConfig(c: LlmConfig, rt: LlmRuntime = {}): LlmProvider | null {
  if (keyOf(c, c.LLM_PROVIDER) === '') return null;
  const primary = build(c, c.LLM_PROVIDER, c.LLM_MODEL, c.LLM_BASE_URL, c.LLM_MAX_RETRIES, c.LLM_TIMEOUT_MS, rt);
  const fb = c.LLM_FALLBACK_PROVIDER;
  if (fb === '' || fb === c.LLM_PROVIDER || keyOf(c, fb) === '') return primary;
  // The fallback is tried once, with no retries.
  const fallback = build(c, fb, c.LLM_FALLBACK_MODEL, '', 0, c.LLM_TIMEOUT_MS, rt);

  return {
    name: primary.name,
    model: primary.model,
    async chat(r: LlmChatRequest): Promise<LlmChatResult> {
      try {
        return await primary.chat(r);
      } catch (err) {
        if (!(err instanceof LlmError) || (err.code !== 'LLM_RATE_LIMITED' && err.code !== 'LLM_UNAVAILABLE') || r.signal.aborted) throw err;
        try {
          return await fallback.chat(r);
        } catch (fbErr) {
          // Report the primary's failure (it carries retryAfterSec when the provider gave one), noting the fallback's.
          err.fallbackProvider = fallback.name;
          if (fbErr instanceof LlmError) err.fallbackCode = fbErr.code;
          throw err;
        }
      }
    },
  };
}

/**
 * The small model that answers the on-topic question: primary provider only, no retries, no fallback, short
 * timeout. Null when the check is off or the primary has no key.
 */
export function createTopicCheckLlm(c: LlmConfig, rt: LlmRuntime = {}): LlmProvider | null {
  if (!c.CHAT_TOPIC_CHECK || keyOf(c, c.LLM_PROVIDER) === '') return null;
  const model = c.CHAT_TOPIC_CHECK_MODEL || PROVIDERS[c.LLM_PROVIDER].topicCheckModel || c.LLM_MODEL;
  return build(c, c.LLM_PROVIDER, model, c.LLM_BASE_URL, 0, c.CHAT_TOPIC_CHECK_TIMEOUT_MS, rt);
}

export function llmStatusOf(c: LlmConfig): { configured: boolean; provider: ProviderId; model: string; fallbackProvider: ProviderId | null } {
  return {
    configured: keyOf(c, c.LLM_PROVIDER) !== '',
    provider: c.LLM_PROVIDER,
    model: c.LLM_MODEL || PROVIDERS[c.LLM_PROVIDER].defaultModel,
    fallbackProvider: c.LLM_FALLBACK_PROVIDER === '' ? null : c.LLM_FALLBACK_PROVIDER,
  };
}
