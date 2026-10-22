export type ProviderId = 'groq' | 'openrouter';

export interface ProviderDefinition {
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: 'GROQ_API_KEY' | 'OPENROUTER_API_KEY';
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  /** Extra body fields sent only when the model id matches. */
  modelExtraBody?: Array<{ match: RegExp; body: Record<string, unknown> }>;
}

export const PROVIDER_IDS = ['groq', 'openrouter'] as const satisfies readonly ProviderId[];

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    // Chosen by the 2026-10-19 tool-calling spike (scripts/dev/llm-probe.mjs): both gpt-oss models were 6/6;
    // the 120b is kept for multi-step turns, and reasoning_effort low stayed 6/6 for it.
    defaultModel: 'openai/gpt-oss-120b',
    apiKeyEnv: 'GROQ_API_KEY',
    // reasoning_effort is a gpt-oss parameter; other Groq models may reject it.
    modelExtraBody: [{ match: /^openai\/gpt-oss-/, body: { reasoning_effort: 'low' } }],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
};
