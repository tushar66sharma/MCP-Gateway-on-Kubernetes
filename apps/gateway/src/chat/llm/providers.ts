export type ProviderId = 'groq' | 'openrouter';

export interface ProviderDefinition {
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: 'GROQ_API_KEY' | 'OPENROUTER_API_KEY';
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  /** Extra body fields sent only when the model id matches. */
  modelExtraBody?: Array<{ match: RegExp; body: Record<string, unknown> }>;
  /** Name of the request field that caps the answer length. */
  maxTokensParam: 'max_completion_tokens' | 'max_tokens';
  /** Model for the topic check; null = the main model. */
  topicCheckModel: string | null;
}

export const PROVIDER_IDS = ['groq', 'openrouter'] as const satisfies readonly ProviderId[];

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    // Chosen by the 2026-10-19 tool-calling spike (scripts/dev/llm-probe.mjs): both gpt-oss models were 6/6;
    // the 120b is kept for multi-step turns, and reasoning_effort low stayed 6/6 for it.
    defaultModel: 'openai/gpt-oss-120b',
    apiKeyEnv: 'GROQ_API_KEY',
    maxTokensParam: 'max_completion_tokens',
    // gpt-oss-20b: llama-3.1-8b-instant is not available on the owner's account (controller ruling 2026-10-23).
    topicCheckModel: 'openai/gpt-oss-20b',
    // reasoning_effort is a gpt-oss parameter; other Groq models may reject it.
    modelExtraBody: [{ match: /^openai\/gpt-oss-/, body: { reasoning_effort: 'low' } }],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    maxTokensParam: 'max_tokens',
    topicCheckModel: null,
  },
};
