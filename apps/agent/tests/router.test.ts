import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import type { ProviderChangeEvent } from '../src/llm/LLMProviderRouter.js';
import { LlmAllProvidersFailedError, LlmRateLimitError, LlmNetworkError } from '../src/llm/errors.js';
import type { LlmChatParams, LlmProviderConfig, LlmResult } from '../src/llm/types.js';

const PRIMARY: LlmProviderConfig = {
  name: 'groq',
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: 'k-groq',
  model: 'llama-3.3-70b-versatile',
  timeoutMs: 3500,
};

const FALLBACK: LlmProviderConfig = {
  name: 'gemini',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey: 'k-gemini',
  model: 'gemini-3.5-flash',
  timeoutMs: 3500,
};

function result(provider: string): LlmResult {
  return { content: `resposta de ${provider}`, toolCalls: [], provider, model: 'mock' };
}

function fakeChat(impl: (params: LlmChatParams, signal?: AbortSignal) => Promise<LlmResult>) {
  return { chat: impl };
}

describe('LLMProviderRouter - fallback automatico', () => {
  it('usa o provedor principal quando ele responde normalmente', async () => {
    const changes: ProviderChangeEvent[] = [];
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      onProviderChange: (e) => changes.push(e),
      createProvider: (config) =>
        fakeChat(() => Promise.resolve(result(config.name))),
    });

    const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(res.provider).toBe('groq');
    expect(changes).toHaveLength(0);
    expect(router.activeProvider).toBe('groq');
  });

  it('migra para o Gemini quando o Groq expira (timeout)', async () => {
    const changes: ProviderChangeEvent[] = [];
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      timeoutMs: 50,
      onProviderChange: (e) => changes.push(e),
      createProvider: (config) =>
        fakeChat((_params, signal) => {
          if (config.name === 'groq') {
            return new Promise<LlmResult>((_resolve, reject) => {
              signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            });
          }
          return Promise.resolve(result(config.name));
        }),
    });

    const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(res.provider).toBe('gemini');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: 'groq', to: 'gemini', reason: 'timeout' });
    expect(router.activeProvider).toBe('gemini');
  });

  it('migra para o Gemini quando o Groq retorna erro de limite (429)', async () => {
    const changes: ProviderChangeEvent[] = [];
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      rateLimitRetries: 0,
      onProviderChange: (e) => changes.push(e),
      createProvider: (config) =>
        fakeChat(() => {
          if (config.name === 'groq') {
            return Promise.reject(new LlmRateLimitError('groq', 429));
          }
          return Promise.resolve(result(config.name));
        }),
    });

    const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(res.provider).toBe('gemini');
    expect(changes[0]?.reason).toBe('rate_limit');
  });

  it('reintenta 429 no primario com backoff antes do failover', async () => {
    let groqCalls = 0;
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      rateLimitRetries: 1,
      backoffBaseMs: 5,
      createProvider: (config) =>
        fakeChat(() => {
          if (config.name === 'groq') {
            groqCalls += 1;
            return groqCalls === 1
              ? Promise.reject(new LlmRateLimitError('groq', 429))
              : Promise.resolve(result(config.name));
          }
          return Promise.resolve(result(config.name));
        }),
    });

    const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(res.provider).toBe('groq');
    expect(groqCalls).toBe(2);
  });

  it('mantem o fallback ativo durante o cooldown (circuit breaker)', async () => {
    let groqCalls = 0;
    const changes: ProviderChangeEvent[] = [];
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      rateLimitRetries: 0,
      coolDownMs: 5000,
      onProviderChange: (e) => changes.push(e),
      createProvider: (config) =>
        fakeChat(() => {
          if (config.name === 'groq') {
            groqCalls += 1;
            return Promise.reject(new LlmRateLimitError('groq', 429));
          }
          return Promise.resolve(result(config.name));
        }),
    });

    const first = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(first.provider).toBe('gemini');
    expect(router.state.circuitOpen).toBe(true);

    // Durante o cooldown, chamadas vao direto ao fallback sem sondar o primario.
    const second = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(second.provider).toBe('gemini');
    expect(groqCalls).toBe(1);
    expect(changes).toHaveLength(1);
  });

  it('volta a sondar o primario depois do cooldown (recovered)', async () => {
    let groqCalls = 0;
    const changes: ProviderChangeEvent[] = [];
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      rateLimitRetries: 0,
      coolDownMs: 20,
      onProviderChange: (e) => changes.push(e),
      createProvider: (config) =>
        fakeChat(() => {
          if (config.name === 'groq') {
            groqCalls += 1;
            return groqCalls === 1
              ? Promise.reject(new LlmRateLimitError('groq', 429))
              : Promise.resolve(result(config.name));
          }
          return Promise.resolve(result(config.name));
        }),
    });

    await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(router.activeProvider).toBe('gemini');

    await new Promise((r) => setTimeout(r, 30));
    const after = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
    expect(after.provider).toBe('groq');
    expect(groqCalls).toBe(2);
    expect(changes.at(-1)).toMatchObject({ from: 'gemini', to: 'groq', reason: 'recovered' });
  });

  it('falha com LlmAllProvidersFailedError quando os dois provedores falham', async () => {
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      rateLimitRetries: 0,
      createProvider: (config) =>
        fakeChat(() => Promise.reject(new LlmRateLimitError(config.name, 429))),
    });

    await expect(router.chat({ messages: [{ role: 'user', content: 'oi' }] })).rejects.toThrow(
      LlmAllProvidersFailedError,
    );
  });

  it('nao faz fallback para erros de requisicao invalida (400)', async () => {
    const router = new LLMProviderRouter({
      primary: PRIMARY,
      fallback: FALLBACK,
      createProvider: (config) =>
        fakeChat(() => Promise.reject(new LlmNetworkError(config.name, 'boom'))),
    });

    await expect(router.chat({ messages: [{ role: 'user', content: 'oi' }] })).rejects.toThrow();
  });
});

describe('LLMProviderRouter - wire real via OpenAI SDK', () => {
  function mockCompletionServer(delayMs = 0) {
    return createServer((req, res) => {
      void (async () => {
        let body = '';
        for await (const chunk of req) body += chunk;
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        const model = JSON.parse(body).model as string;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: `ok do modelo ${model}` },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
          }),
        );
      })();
    });
  }

  function listen(server: ReturnType<typeof mockCompletionServer>): Promise<string> {
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}/v1`);
      });
    });
  }

  it('faz a requisicao completa contra o formato Chat Completions (primario)', async () => {
    const primary = mockCompletionServer();
    const primaryURL = await listen(primary);
    try {
      const router = new LLMProviderRouter({
        primary: { ...PRIMARY, baseURL: primaryURL, timeoutMs: 2000 },
        fallback: { ...FALLBACK, baseURL: 'http://127.0.0.1:1/v1' },
      });

      const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
      expect(res.content).toBe('ok do modelo llama-3.3-70b-versatile');
      expect(res.provider).toBe('groq');
    } finally {
      primary.close();
    }
  });

  it('timeout no primario migra o request para o fallback (wire real)', async () => {
    const slow = mockCompletionServer(400);
    const fast = mockCompletionServer(0);
    const slowURL = await listen(slow);
    const fastURL = await listen(fast);
    try {
      const changes: ProviderChangeEvent[] = [];
      // timeoutMs do router sobrescreve o do primario
      const router = new LLMProviderRouter({
        primary: { ...PRIMARY, baseURL: slowURL },
        fallback: { ...FALLBACK, baseURL: fastURL },
        timeoutMs: 120,
        onProviderChange: (e) => changes.push(e),
      });

      const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
      expect(res.provider).toBe('gemini');
      expect(res.content).toBe('ok do modelo gemini-3.5-flash');
      expect(changes[0]?.reason).toBe('timeout');
    } finally {
      slow.close();
      fast.close();
    }
  });

  it('429 no primario (wire real) migra para o fallback', async () => {
    const rateLimited = createServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
    });
    const fast = mockCompletionServer(0);
    const limitedURL = await listen(rateLimited);
    const fastURL = await listen(fast);
    try {
      const router = new LLMProviderRouter({
        primary: { ...PRIMARY, baseURL: limitedURL, timeoutMs: 2000 },
        fallback: { ...FALLBACK, baseURL: fastURL, timeoutMs: 2000 },
        rateLimitRetries: 0,
      });
      const res = await router.chat({ messages: [{ role: 'user', content: 'oi' }] });
      expect(res.provider).toBe('gemini');
    } finally {
      rateLimited.close();
      fast.close();
    }
  });
});
