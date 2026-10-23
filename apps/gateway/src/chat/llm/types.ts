export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** `arguments` is the raw JSON text exactly as the model produced it (it may not parse). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmChatRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
  /** Epoch ms by which the whole turn must end; the provider never sleeps past it. */
  deadline: number;
  /** Output cap for this call; undefined = the provider's configured default (LLM_MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
  /** Sampling temperature for this call; undefined = 0.2 (every main-model call). The topic check uses 0. */
  temperature?: number;
}

export interface LlmChatResult {
  message: ChatMessage;
  toolCalls: ToolCall[];
  usage?: Usage;
  /** Why the model stopped, normalised; absent when the provider did not say. */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'other';
  provider: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  chat(r: LlmChatRequest): Promise<LlmChatResult>;
}
