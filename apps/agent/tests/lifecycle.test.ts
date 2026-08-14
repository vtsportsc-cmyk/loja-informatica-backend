import { describe, it, expect } from 'vitest';
import { MessageHandler } from '../src/agent/MessageHandler.js';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import { ToolRegistry } from '../src/agent/ToolRegistry.js';
import { CartCalculatorSkill, HardwareCompatibilitySkill, ProductSpecResolver } from '../src/agent/ToolRegistry.js';
import { KnowledgeBase } from '../src/rag/knowledgeBase.js';
import { BotStateId } from '../src/fsm/states.js';
import { PaymentWebhookProcessor } from '../src/integration/payment/PaymentWebhookProcessor.js';
import { createPaymentExpiryJob } from '../src/agent/paymentExpiryJob.js';
import { defaultFreightCalculator } from '../src/agent/ToolRegistry.js';
import { MockErpAdapter } from './mocks/erp.js';
import { mockAgentInbound, ScriptedRouter } from './mocks/events.js';
import type { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import type { SessionState } from '../src/agent/types.js';
import type { AgentInbound } from '../src/types/index.js';

const freight = async (zip: string) => ({
  freightCents: 2500,
  estimatedDays: 2,
  method: 'PAC',
});

describe('MessageHandler - recalculo de carrinho mantem o CEP', () => {
  function build() {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
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
    return { erp, sessionStore, knowledgeBase, tools };
  }

  it('segundo calculate_cart sem CEP reutiliza o CEP da sessao (fix)', async () => {
    const { sessionStore, knowledgeBase, tools } = build();
    const inbound = (text: string): AgentInbound =>
      mockAgentInbound({
        message: { id: 'm', type: 'text', text, timestamp: new Date().toISOString() },
      });

    const handler1 = new MessageHandler({
      router: new ScriptedRouter([
        {
          toolCalls: [
            { id: 'c1', name: 'identify_intent', arguments: { intent: 'purchase' } },
          ],
        },
        {
          toolCalls: [
            {
              id: 'c2',
              name: 'calculate_cart',
              arguments: {
                skus: [{ sku: 'CPU-8600G', quantity: 1 }, { sku: 'MB-B650M', quantity: 1 }],
                zipCode: '01310100',
              },
            },
          ],
        },
        { content: 'total com frete montado' },
      ]) as unknown as LLMProviderRouter,
      tools,
      sessionStore,
      knowledgeBase,
    });

    await handler1.processInbound(inbound('quero montar um pc'));

    const first = await sessionStore.get('5511999990000');
    expect(first?.cart?.freightCents).toBe(3700);

    const handler2 = new MessageHandler({
      router: new ScriptedRouter([
        {
          toolCalls: [
            {
              id: 'c3',
              name: 'calculate_cart',
              arguments: {
                skus: [{ sku: 'CPU-8600G', quantity: 1 }, { sku: 'MB-B650M', quantity: 1 }],
              },
            },
          ],
        },
        { content: 'recalculado' },
      ]) as unknown as LLMProviderRouter,
      tools,
      sessionStore,
      knowledgeBase,
    });

    await handler2.processInbound(inbound('quero o total de novo'));

    const second = await sessionStore.get('5511999990000');
    expect(second?.cart?.zipCode).toBe('01310100');
    expect(second?.cart?.freightCents).toBe(3700);
    expect(second?.cart?.freightDetail?.cep).toBe('01310100');
  });
});

describe('KnowledgeBase - RAG dinamico a partir do catalogo do ERP', () => {
  it('ingere itens do estoque como produtos consultaveis', () => {
    const kb = new KnowledgeBase([]);
    kb.ingest(
      KnowledgeBase.fromStockItems([
        {
          sku: 'CPU-NOVA',
          name: 'AMD Ryzen 7 9700X',
          category: 'Processador',
          specs: { socket: 'AM5', tdpW: '65' },
        },
      ]),
    );

    const hits = kb.search('Ryzen 9700X', 1);
    expect(hits[0]?.product.id).toBe('erp-CPU-NOVA');
    expect(hits[0]?.product.category).toBe('cpu');
    expect(hits[0]?.product.specs.socket).toBe('AM5');
  });
});

describe('MessageHandler - rastreamento de pedido (TRACK_ORDER)', () => {
  it('classifica track_order, consulta o pedido e salva o status rastreado', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    const knowledgeBase = new KnowledgeBase();
    await sessionStore.save({
      ticketId: 'TKT-TRACK',
      botState: BotStateId.PAYMENT_CONFIRMED,
      customerId: 'CUST-9',
      wishlist: [],
      cart: null,
      lockIds: [],
      orderId: 'ORDER-777',
      updatedAt: new Date().toISOString(),
    });

    const tools = new ToolRegistry({
      hardwareCompatibility: new HardwareCompatibilitySkill({
        resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
      }),
      cartCalculator: new CartCalculatorSkill(
        { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
        freight,
      ),
      getOrderStatus: async (orderId) => {
        const found = sessionStore.findByOrderId(orderId);
        if (!found) return null;
        return { orderId, status: 'awaiting_nf', createdAt: found.updatedAt };
      },
    });

    const script = [
      {
        toolCalls: [
          { id: 'call-intent', name: 'identify_intent', arguments: { intent: 'track_order' } },
        ],
      },
      {
        toolCalls: [
          { id: 'call-track', name: 'check_order_status', arguments: { orderId: 'ORDER-777' } },
        ],
      },
      { content: 'Seu pedido ORDER-777 esta aguardando nota fiscal.' },
    ];
    const router = new ScriptedRouter(script) as unknown as LLMProviderRouter;
    const handler = new MessageHandler({ router, tools, sessionStore, knowledgeBase });

    const response = await handler.processInbound(
      mockAgentInbound({
        ticketId: 'TKT-TRACK',
        customer: { id: 'CUST-9', phone: '5511999990000', name: 'Cliente Teste' },
      }),
    );

    const session = await sessionStore.get('TKT-TRACK');
    expect(session?.botState).toBe(BotStateId.TRACK_ORDER);
    expect(session?.intent).toBe('track_order');
    expect(session?.lastTrackedOrder?.orderId).toBe('ORDER-777');
    expect(session?.lastTrackedOrder?.status).toBe('awaiting_nf');
    expect(response.reply.text).toContain('ORDER-777');
  });
});

describe('PaymentWebhookProcessor - ciclo de vida PIX', () => {
  async function seedPending(
    sessionStore: InMemorySessionStore,
    erp: MockErpAdapter,
  ): Promise<SessionState> {
    const lock1 = await erp.lockItem('CPU-8600G', 1);
    const lock2 = await erp.lockItem('MB-B650M', 1);
    const session: SessionState = {
      ticketId: 'TKT-1001',
      botState: BotStateId.PAYMENT_PENDING,
      customerId: 'CUST-42',
      intent: 'purchase',
      wishlist: [],
      cart: {
        items: [
          { sku: 'CPU-8600G', name: 'AMD Ryzen 5 8600G', quantity: 1, unitPriceCents: 119990, lockId: lock1.lockId },
          { sku: 'MB-B650M', name: 'Gigabyte B650M Gaming WiFi', quantity: 1, unitPriceCents: 149990, lockId: lock2.lockId },
        ],
        subtotalCents: 269980,
        freightCents: 2500,
        totalCents: 272480,
      },
      charge: { method: 'pix', chargeId: 'CHARGE-1', status: 'pending' },
      chargeExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      lockIds: [lock1.lockId, lock2.lockId],
      updatedAt: new Date().toISOString(),
    };
    await sessionStore.save(session);
    return session;
  }

  it('expira a cobranca, libera os locks e volta para STOCK_AND_FREIGHT', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPending(sessionStore, erp);

    const evolutionCalls: string[] = [];
    const processor = new PaymentWebhookProcessor({
      paymentClient: {
        handleNotification: async () => {
          throw new Error('nao deveria chamar');
        },
      } as never,
      erpClient: erp as never,
      evolution: {
        sendReply: async () => {
          evolutionCalls.push('sendReply');
        },
      } as never,
      sessionStore,
    });

    const result = await processor.expire('TKT-1001');
    expect(result.status).toBe('expired');
    expect(result.botState).toBe(BotStateId.STOCK_AND_FREIGHT);
    expect(result.releasedLocks).toHaveLength(2);

    const session = await sessionStore.get('TKT-1001');
    expect(session?.botState).toBe(BotStateId.STOCK_AND_FREIGHT);
    expect(session?.charge).toBeUndefined();
    expect(session?.lockIds).toEqual([]);
    expect([...erp.locks.values()].every((l) => l.status === 'released')).toBe(true);
    expect(evolutionCalls).toEqual(['sendReply']);
  });

  it('cancela a cobranca (desistencia) e ignora sessoes fora de PAYMENT_PENDING', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPending(sessionStore, erp);

    const processor = new PaymentWebhookProcessor({
      paymentClient: {
        handleNotification: async () => {
          throw new Error('nao deveria chamar');
        },
      } as never,
      erpClient: erp as never,
      evolution: { sendReply: async () => undefined } as never,
      sessionStore,
    });

    const cancelled = await processor.cancel('TKT-1001');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.botState).toBe(BotStateId.STOCK_AND_FREIGHT);

    const ignored = await processor.cancel('TKT-1001');
    expect(ignored.status).toBe('ignored');
    expect(ignored.botState).toBe(BotStateId.STOCK_AND_FREIGHT);
  });
});

describe('PaymentExpiryJob', () => {
  it('varre e expira apenas sessoes PAYMENT_PENDING com cobranca vencida', async () => {
    const sessionStore = new InMemorySessionStore();
    const expired = {
      ticketId: 'TKT-EXPIRED',
      botState: BotStateId.PAYMENT_PENDING,
      customerId: 'C-1',
      wishlist: [],
      cart: null,
      lockIds: [],
      chargeExpiresAt: new Date(Date.now() - 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const future = {
      ticketId: 'TKT-FUTURE',
      botState: BotStateId.PAYMENT_PENDING,
      customerId: 'C-2',
      wishlist: [],
      cart: null,
      lockIds: [],
      chargeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await sessionStore.save(expired);
    await sessionStore.save(future);

    const expiredTickets: string[] = [];
    const job = createPaymentExpiryJob({
      sessionStore,
      expire: async (ticketId) => {
        expiredTickets.push(ticketId);
      },
    });

    const n = await job.scan();
    expect(n).toBe(1);
    expect(expiredTickets).toEqual(['TKT-EXPIRED']);
    job.stop();
  });
});
