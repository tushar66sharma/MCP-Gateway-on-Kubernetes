export type ProviderId = 'groq' | 'openrouter';

export interface ProviderDefinition {
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: 'GROQ_API_KEY' | 'OPENROUTER_API_KEY';
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export const PROVIDER_IDS = ['groq', 'openrouter'] as const satisfies readonly ProviderId[];

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    // Chosen by the 2026-10-19 tool-calling spike (scripts/dev/llm-probe.mjs): 6/6 correct for both gpt-oss
    // models, the 20b with fewer tokens; reasoning_effort low stayed 6/6 with fewer completion tokens.
    defaultModel: 'openai/gpt-oss-20b',
    apiKeyEnv: 'GROQ_API_KEY',
    extraBody: { reasoning_effort: 'low' },
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
};
