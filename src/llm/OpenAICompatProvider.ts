import OpenAI from 'openai';
import {
  LlmAuthError,
  LlmHttpError,
  LlmNetworkError,
  LlmProviderTimeoutError,
  LlmRateLimitError,
} from './errors.js';
import type {
  LlmChatParams,
  LlmProviderConfig,
  LlmResult,
  LlmToolCall,
} from './types.js';

// Adapter para qualquer API compatível com a OpenAI SDK.
// Usado tanto para o Groq (primario) quanto para o Google AI Studio / Gemini (fallback).

export class OpenAICompatProvider {
  readonly config: LlmProviderConfig;
  private readonly client: OpenAI;

  constructor(config: LlmProviderConfig, client?: OpenAI) {
    this.config = config;
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        maxRetries: 0,
        timeout: config.timeoutMs,
      });
  }

  async chat(params: LlmChatParams, signal?: AbortSignal): Promise<LlmResult> {
    const start = performance.now();

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        params.messages.map((m) => {
          switch (m.role) {
            case 'system':
              return { role: 'system', content: m.content };
            case 'user':
              return { role: 'user', content: m.content };
            case 'assistant':
              return { role: 'assistant', content: m.content };
            case 'tool':
              return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' };
          }
        });

      response = await this.client.chat.completions.create(
        {
          model: this.config.model,
          messages,
          ...(params.tools?.length
            ? {
                tools: params.tools.map((fn) => ({
                  type: 'function' as const,
                  function: {
                    name: fn.name,
                    description: fn.description,
                    parameters: fn.parameters,
                  },
                })),
              }
            : {}),
          ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          ...(params.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
        },
        signal ? { signal } : undefined,
      );
    } catch (err) {
      throw this.mapError(err);
    }

    const choice = response.choices[0];
    const elapsedMs = Math.round(performance.now() - start);

    const toolCalls: LlmToolCall[] = (choice?.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments),
    }));

    return {
      content: choice?.message.content ?? null,
      toolCalls,
      provider: this.config.name,
      model: this.config.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      },
      raw: { elapsedMs, response },
    };
  }

  private mapError(err: unknown): Error {
    if (err instanceof OpenAI.APIUserAbortError) {
      // Abort do fetch (timeout do roteador/signal) chega como APIUserAbortError.
      return new LlmProviderTimeoutError(this.config.name, this.config.timeoutMs);
    }
    if (err instanceof OpenAI.APIError) {
      const status = err.status;
      if (status === 429) return new LlmRateLimitError(this.config.name, status);
      if (status === 401 || status === 403) return new LlmAuthError(this.config.name, status);
      if (status >= 500) return new LlmHttpError(this.config.name, status, err.message);
      return new LlmHttpError(this.config.name, status ?? 400, err.message);
    }
    return new LlmNetworkError(this.config.name, err);
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
