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
    defaultModel: 'openai/gpt-oss-120b',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
};
