import { describe, it, expect } from 'vitest';
import type { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import { MessageHandler } from '../src/agent/MessageHandler.js';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import {
  CartCalculatorSkill,
  defaultFreightCalculator,
  HardwareCompatibilitySkill,
  ProductSpecResolver,
  ToolRegistry,
} from '../src/agent/ToolRegistry.js';
import { KnowledgeBase } from '../src/rag/knowledgeBase.js';
import { Metrics } from '../src/observability/metrics.js';
import type { EvolutionApi } from '../src/integration/evolution/EvolutionApi.js';
import { EvolutionWebhookHandler, findQuoteCode } from '../src/webhooks/evolution.js';
import { InMemoryMessageRepository } from '../src/prisma/MessageRepository.js';
import { mockEvolutionMessage, ScriptedRouter } from './mocks/events.js';
import { MockErpAdapter } from './mocks/erp.js';

function buildHandler(repository: InMemoryMessageRepository) {
  const erp = new MockErpAdapter();
  const knowledgeBase = new KnowledgeBase();
  const tools = new ToolRegistry({
    hardwareCompatibility: new HardwareCompatibilitySkill({
      resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
    }),
    cartCalculator: new CartCalculatorSkill(
      { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
      defaultFreightCalculator,
    ),
  });
  const router = new ScriptedRouter([{ content: 'Recebemos o orcamento! Um vendedor vai confirmar.' }]) as unknown as LLMProviderRouter;
  const handler = new MessageHandler({
    router,
    tools,
    sessionStore: new InMemorySessionStore(),
    knowledgeBase,
    metrics: new Metrics(),
  });
  const evolution = { sendReply: async () => {} } as unknown as EvolutionApi;
  return new EvolutionWebhookHandler({ repository, messageHandler: handler, evolution, logger: () => {} });
}

describe('Oportunidade de Alto Valor (orcamento do Monte seu PC)', () => {
  it('findQuoteCode detecta o codigo Q-XXXXXX no texto', () => {
    expect(findQuoteCode('veja meu orcamento Q-AB2CDE')).toBe('Q-AB2CDE');
    expect(findQuoteCode('link: https://loja.dev/quote/q-abc2de')).toBe('Q-ABC2DE');
    expect(findQuoteCode('sem codigo aqui')).toBeNull();
    expect(findQuoteCode(undefined)).toBeNull();
    expect(findQuoteCode('Q-12345 não completo')).toBeNull();
  });

  it('webhook com codigo de orcamento marca ALTA_VALOR e vincula o pedido', async () => {
    const repository = new InMemoryMessageRepository();
    repository.seedQuote({
      id: 'quote-1',
      code: 'Q-AB2CDE',
      totalCents: 500000,
      pixTotalCents: 475000,
      customer: { name: null, phone: '5511999990000' },
      items: [{ sku: 'CPU-8600G', name: 'AMD Ryzen 5 8600G', unitPriceCents: 119990, quantity: 1 }],
    });
    const handler = buildHandler(repository);

    const result = await handler.handle(
      mockEvolutionMessage(
        'Olá! Montei este PC no Monte Seu PC e quero confirmar.\nCódigo do orçamento: Q-AB2CDE',
      ),
    );
    expect(result.ok).toBe(true);

    const conv = await repository.getConversationByWhatsapp('5511999990000');
    expect(conv).not.toBeNull();
    expect(conv?.funnelStatus).toBe('ALTA_VALOR');
    expect(conv?.unreadCount).toBe(2);

    const linked = await repository.getQuoteForConversation(conv!.id);
    expect(linked?.code).toBe('Q-AB2CDE');
  });

  it('nao promove conversas que ja avancaram no funil', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999991111', 'Lead Avancado');
    await repository.setFunnelStatus(conv.id, 'CARRINHO');
    repository.seedQuote({
      id: 'quote-2',
      code: 'Q-ZZ9999',
      totalCents: 100000,
      pixTotalCents: 95000,
      customer: { name: 'Lead Avancado', phone: '5511999991111' },
      items: [],
    });

    const result = await repository.markHighValueOpportunity(conv.id, 'Q-ZZ9999');
    expect(result.flagged).toBe(true);
    expect(result.linked).toBe(true);

    const updated = await repository.getConversationById(conv.id);
    expect(updated?.funnelStatus).toBe('CARRINHO');
  });
});
