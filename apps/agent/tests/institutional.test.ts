import { describe, it, expect } from 'vitest';
import { InstitutionalAnswerService } from '../src/rag/institutionalAnswers.js';
import { MemoryInstitutionalCache } from '../src/rag/institutionalCache.js';
import { MessageHandler } from '../src/agent/MessageHandler.js';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import { Metrics } from '../src/observability/metrics.js';
import { InMemoryMessageRepository } from '../src/prisma/MessageRepository.js';
import { mockAgentInbound } from './mocks/events.js';
import type { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import type { LlmChatMessage } from '../src/llm/types.js';

// ============================================================================
// Cache de respostas institucionais + metricas de LLM (tokens/tempo).
// Regras do matcher: keywords/frases deterministicas, sem custo de LLM.
// ============================================================================

const emptyTools = { definitions: [], execute: async () => 'ok' };

function buildHandler(overrides: {
  router?: LLMProviderRouter;
  answerService?: InstitutionalAnswerService;
  metrics?: Metrics;
} = {}) {
  const router =
    overrides.router ?? ({ activeProvider: 'none', state: { activeProvider: 'none', fallbackActive: false, circuitOpen: false, circuitOpenUntil: 0 } } as unknown as LLMProviderRouter);
  const handler = new MessageHandler({
    router,
    tools: emptyTools,
    sessionStore: new InMemorySessionStore(),
    answerService: overrides.answerService,
    metrics: overrides.metrics ?? new Metrics(),
  });
  return handler;
}

describe('InstitutionalAnswerService - matcher deterministico', () => {
  const service = new InstitutionalAnswerService({ cache: new MemoryInstitutionalCache() });

  it('responde duvidas institucionais frequentes (faqId correto)', async () => {
    const cases: Array<[string, string]> = [
      ['qual e o endereco da loja?', 'endereco-loja'],
      ['onde fica a loja?', 'endereco-loja'],
      ['qual o horario de atendimento?', 'atendimento-horario'],
      ['quais as formas de pagamento?', 'pagamento-formas'],
      ['aceitam pix?', 'pagamento-formas'],
      ['voces parcelam no cartao?', 'pagamento-formas'],
      ['qual a garantia dos produtos?', 'garantia-padrao'],
      ['qual o prazo de entrega?', 'entrega-prazo'],
      ['quero falar com um atendente', 'atendimento-contato'],
    ];
    for (const [message, expected] of cases) {
      const result = await service.tryAnswer(message);
      expect(result?.faqId, message).toBe(expected);
    }
  });

  it('evita falsos positivos (precos, rastreio de pedido)', async () => {
    const nonMatches = [
      'quanto custa uma rtx 4060?',
      'qual o valor da fonte corsair rm650x?',
      'onde fica meu pedido?',
    ];
    for (const message of nonMatches) {
      const result = await service.tryAnswer(message);
      expect(result, message).toBeNull();
    }
  });

  it('ignora mensagens longas demais para ser duvida institucional', async () => {
    const long = 'quero montar um pc gamer para jogar fortnite e valorant e ainda tenho duvida sobre a fonte';
    expect(await service.tryAnswer(long)).toBeNull();
  });
});

describe('InstitutionalAnswerService - fluxo de cache', () => {
  it('popula o cache no primeiro match e serve cache no segundo', async () => {
    const service = new InstitutionalAnswerService({ cache: new MemoryInstitutionalCache() });

    const first = await service.tryAnswer('qual e o endereco da loja?');
    expect(first?.cached).toBe(false);
    expect(first?.text).toContain('Paulista');

    const second = await service.tryAnswer('onde fica a loja?');
    expect(second?.cached).toBe(true);
    expect(second?.faqId).toBe('endereco-loja');
    expect(second?.text).toBe(first?.text);

    expect(service.stats()).toEqual({ matched: 2, cacheHits: 1 });
  });

  it('reflete as estatisticas no service', async () => {
    const service = new InstitutionalAnswerService({ cache: new MemoryInstitutionalCache() });
    await service.tryAnswer('qual o horario de atendimento?');
    await service.tryAnswer('qual o horario de atendimento?');
    expect(service.stats()).toEqual({ matched: 2, cacheHits: 1 });
  });
});

describe('MessageHandler - respostas institucionais (zero tokens)', () => {
  it('serve resposta do cache sem chamar a LLM e marca llm.cached', async () => {
    const metrics = new Metrics();
    const answerService = new InstitutionalAnswerService({ cache: new MemoryInstitutionalCache() });
    const router = {
      activeProvider: 'scripted',
      state: { activeProvider: 'scripted', fallbackActive: false, circuitOpen: false, circuitOpenUntil: 0 },
      calls: 0,
      async chat() {
        this.calls += 1;
        throw new Error('LLM nao deveria ser chamada para resposta institucional');
      },
    } as unknown as LLMProviderRouter & { calls: number };

    const handler = buildHandler({ router, answerService, metrics });
    const inbound = mockAgentInbound({ message: { id: 'MSG-CACHE', type: 'text', text: 'qual e o endereco da loja?', timestamp: new Date().toISOString() } });

    const response = await handler.processInbound(inbound);

    expect((router as unknown as { calls: number }).calls).toBe(0);
    expect(response.reply.text).toContain('Paulista');
    expect(response.reply.llm).toEqual({
      tokensUsed: 0,
      responseTimeMs: expect.any(Number),
      provider: 'institutional',
      model: 'endereco-loja',
      cached: true,
    });
    expect(metrics.snapshot().institutionalAnswers).toEqual({ matched: 1, cacheHits: 0 });
  });

  it('rota normal segue sem cache e acumula tokens/ tempo da LLM', async () => {
    const metrics = new Metrics();
    const handler = buildHandler({
      metrics,
      router: {
        activeProvider: 'scripted',
        state: { activeProvider: 'scripted', fallbackActive: false, circuitOpen: false, circuitOpenUntil: 0 },
        async chat() {
          return {
            content: 'Resposta gerada pela IA.',
            toolCalls: [],
            provider: 'scripted',
            model: 'mock',
            usage: { promptTokens: 120, completionTokens: 30 },
          };
        },
      } as unknown as LLMProviderRouter,
    });

    const inbound = mockAgentInbound();
    const response = await handler.processInbound(inbound);

    expect(response.reply.text).toBe('Resposta gerada pela IA.');
    expect(response.reply.llm).toMatchObject({
      tokensUsed: 150,
      provider: 'scripted',
      model: 'mock',
      cached: false,
    });
    expect(response.reply.llm?.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(metrics.snapshot().institutionalAnswers.matched).toBe(0);
  });
});

describe('MessageHandler - Prompt Context Guard', () => {
  it('injeta as diretrizes rigidas no system prompt', async () => {
    let captured: LlmChatMessage[] = [];
    const router = {
      activeProvider: 'scripted',
      state: { activeProvider: 'scripted', fallbackActive: false, circuitOpen: false, circuitOpenUntil: 0 },
      async chat(opts: { messages: LlmChatMessage[] }) {
        captured = [...opts.messages];
        return { content: 'ok', toolCalls: [], provider: 'scripted', model: 'mock' };
      },
    } as unknown as LLMProviderRouter;

    const handler = buildHandler({ router });
    await handler.processInbound(mockAgentInbound());

    const system = captured[0]?.content ?? '';
    expect(system).toContain('Diretrizes RIGIDAS');
    expect(system).toContain('NUNCA altere, invente ou informe precos');
    expect(system).toContain('Monte seu PC');
    expect(system).toContain('handoff');
  });
});

describe('MessageRepository - persistencia das metricas de LLM', () => {
  it('salva tokensUsed e responseTimeMs nas mensagens outbound', async () => {
    const repo = new InMemoryMessageRepository();
    const conversation = await repo.ensureConversation('5511999990000', 'Cliente Teste');

    await repo.saveOutboundMessage(conversation.id, {
      type: 'text',
      text: 'Resposta da IA.',
      tokensUsed: 150,
      responseTimeMs: 812,
    });
    await repo.saveInboundMessage(conversation.id, { type: 'text', text: 'ola' });

    const messages = await repo.listMessages(conversation.id);
    const outbound = messages.items.find((m) => m.direction === 'outbound');
    const inbound = messages.items.find((m) => m.direction === 'inbound');

    expect(outbound?.tokensUsed).toBe(150);
    expect(outbound?.responseTimeMs).toBe(812);
    expect(inbound?.tokensUsed).toBe(0);
    expect(inbound?.responseTimeMs).toBe(0);
  });
});
