// Tipos comuns ao motor de LLM. Compatíveis com a OpenAI Chat Completions API.

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmChatMessage {
  role: LlmRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface LlmFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmChatParams {
  messages: LlmChatMessage[];
  tools?: LlmFunctionDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmResult {
  content: string | null;
  toolCalls: LlmToolCall[];
  provider: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  raw?: unknown;
}

export interface LlmProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}
