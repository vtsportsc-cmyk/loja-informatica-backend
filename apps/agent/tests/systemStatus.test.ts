import { describe, it, expect } from 'vitest';
import { collectSystemStatus } from '../src/routes/health.js';
import type { SystemStatusDeps } from '../src/routes/health.js';
import { Metrics } from '../src/observability/metrics.js';
import { EvolutionApi } from '../src/integration/evolution/EvolutionApi.js';
import { InMemoryMessageRepository } from '../src/prisma/MessageRepository.js';

function okEvolution(): EvolutionApi {
  return new EvolutionApi({
    baseURL: 'http://evolution.test',
    instance: 'loja',
    apiKey: 't',
    fetchImpl: (async () =>
      new Response(JSON.stringify({ instance: { state: 'open' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

function connectingEvolution(): EvolutionApi {
  return new EvolutionApi({
    baseURL: 'http://evolution.test',
    instance: 'loja',
    apiKey: 't',
    fetchImpl: (async () =>
      new Response(JSON.stringify({ instance: { state: 'connecting' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

function offlineEvolution(): EvolutionApi {
  return new EvolutionApi({
    baseURL: 'http://evolution.test',
    instance: 'loja',
    apiKey: 't',
    fetchImpl: (async () =>
      new Response(JSON.stringify({ instance: { state: 'close' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

function redisOk(): SystemStatusDeps['redis'] {
  return {
    ping: async () => 'PONG',
    get: async () => null,
    set: async () => true,
    del: async () => true,
    keys: async () => [],
  };
}

function redisDown(): SystemStatusDeps['redis'] {
  return {
    ping: async () => {
      throw new Error('conexao recusada');
    },
    get: async () => null,
    set: async () => true,
    del: async () => true,
    keys: async () => [],
  };
}

function baseDeps(overrides: Partial<SystemStatusDeps> = {}): SystemStatusDeps {
  return {
    evolution: okEvolution(),
    metrics: new Metrics(),
    repository: new InMemoryMessageRepository(),
    provider: { activeProvider: 'groq' },
    ...overrides,
  };
}

describe('collectSystemStatus - telemetria do sistema', () => {
  it('reporta tudo ok com processo, banco em memoria, redis e WhatsApp conectados', async () => {
    const metrics = new Metrics();
    metrics.recordLlmCall({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      ok: true,
      elapsedMs: 1200,
      promptTokens: 100,
      completionTokens: 50,
      failover: false,
      retried: false,
    });
    const status = await collectSystemStatus(baseDeps({ metrics, redis: redisOk() }));

    expect(status.overall).toBe('ok');
    expect(status.agent.status).toBe('ok');
    expect(status.agent.activeProvider).toBe('groq');
    expect(status.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(status.process.memoryRssMb).toBeGreaterThan(0);
    expect(status.database.status).toBe('ok');
    expect(status.database.message).toBe('em memória (sem banco)');
    expect(status.redis.status).toBe('ok');
    expect(status.evolution.status).toBe('ok');
    expect(status.evolution.state).toBe('open');
  });

  it('calcula o tempo medio de resposta das chamadas de IA', async () => {
    const metrics = new Metrics();
    for (const ms of [1000, 2000, 3000]) {
      metrics.recordLlmCall({
        provider: 'groq',
        model: 'm',
        ok: true,
        elapsedMs: ms,
        failover: false,
        retried: false,
      });
    }
    const status = await collectSystemStatus(baseDeps({ metrics }));
    expect(status.llm.calls).toBe(3);
    expect(status.llm.averageResponseMs).toBe(2000);
  });

  it('cai para down quando o WhatsApp (Evolution) esta desconectado', async () => {
    const status = await collectSystemStatus(baseDeps({ evolution: offlineEvolution() }));
    expect(status.overall).toBe('down');
    expect(status.evolution.status).toBe('down');
    expect(status.evolution.state).toBe('close');
  });

  it('reporta degraded quando a instancia do WhatsApp esta conectando', async () => {
    const status = await collectSystemStatus(baseDeps({ evolution: connectingEvolution() }));
    expect(status.overall).toBe('degraded');
    expect(status.evolution.status).toBe('degraded');
    expect(status.evolution.message).toContain('conectando');
  });

  it('reporta degraded quando o Redis nao responde ao ping', async () => {
    const status = await collectSystemStatus(baseDeps({ redis: redisDown() }));
    expect(status.redis.status).toBe('degraded');
    expect(status.overall).toBe('degraded');
  });

  it('reporta ok sem redis configurado (design de memoria)', async () => {
    const status = await collectSystemStatus(baseDeps({ redis: undefined }));
    expect(status.redis.status).toBe('ok');
    expect(status.redis.message).toContain('memória');
  });

  it('reporta down quando o banco falha no ping', async () => {
    const repository = {
      ping: async () => false,
    } as unknown as SystemStatusDeps['repository'];
    const status = await collectSystemStatus(baseDeps({ repository }));
    expect(status.database.status).toBe('down');
    expect(status.overall).toBe('down');
  });
});
