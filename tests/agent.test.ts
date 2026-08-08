import { describe, it, expect } from 'vitest';
import { MessageHandler } from '../src/agent/MessageHandler.js';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import { ToolRegistry } from '../src/agent/ToolRegistry.js';
import { CartCalculatorSkill, HardwareCompatibilitySkill, ProductSpecResolver } from '../src/agent/ToolRegistry.js';
import { KnowledgeBase } from '../src/rag/knowledgeBase.js';
import { BotStateId } from '../src/fsm/states.js';
import type { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import type { PaymentNotification } from '../src/types/index.js';
import { PaymentWebhookProcessor } from '../src/integration/payment/PaymentWebhookProcessor.js';
import { MockErpAdapter } from './mocks/erp.js';
import {
  fullPurchaseScript,
  mockSuriInbound,
  pixApprovedNotification,
  creditCardApprovedNotification,
  ScriptedRouter,
} from './mocks/events.js';

const freight = async (zip: string) => ({
  freightCents: zip === '01310100' ? 2500 : 4000,
  estimatedDays: 2,
  method: 'PAC',
});

function buildHandler(script: ReturnType<typeof fullPurchaseScript>) {
  const erp = new MockErpAdapter();
  const sessionStore = new InMemorySessionStore();
  const knowledgeBase = new KnowledgeBase();
  const tools = new ToolRegistry({
    hardwareCompatibility: new HardwareCompatibilitySkill({
      resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
    }),
    cartCalculator: new CartCalculatorSkill(
      { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
      freight,
    ),
  });
  const router = new ScriptedRouter(script) as unknown as LLMProviderRouter;
  const handler = new MessageHandler({ router, tools, sessionStore, knowledgeBase });
  return { handler, erp, sessionStore };
}

describe('MessageHandler - fluxo autonomo completo', () => {
  it('leva o ticket de GREETING ate PAYMENT_PENDING', async () => {
    const { handler, erp, sessionStore } = buildHandler(fullPurchaseScript());
    const inbound = mockSuriInbound();

    const response = await handler.processInbound(inbound);

    expect(response.ticketUpdate?.status).toBe('awaiting_payment');

    const session = await sessionStore.get('TKT-1001');
    expect(session?.botState).toBe(BotStateId.PAYMENT_PENDING);
    expect(session?.intent).toBe('purchase');
    expect(session?.wishlist).toHaveLength(5);
    expect(session?.lastCompatibility?.compatible).toBe(true);
    expect(session?.cart?.items).toHaveLength(5);
    // 1199,90 + 1499,90 + 2x349,90 + 799,90 + 599,90 = 4.799,40 + frete 25,00
    expect(session?.cart?.totalCents).toBe(482440);
    expect(session?.lockIds).toHaveLength(5);
    expect(erp.locks.size).toBe(5);
    expect(response.reply.text).toContain('compativel');
  });

  it('incompatibilidade de memoria mantem o ticket em HARDWARE_CHECK', async () => {
    const script = [
      {
        toolCalls: [
          {
            id: 'call-intent',
            name: 'identify_intent',
            arguments: {
              intent: 'hardware_check',
              wishlist: [{ description: 'placa B650M', quantity: 1 }],
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'call-hardware',
            name: 'check_hardware_compatibility',
            arguments: {
              items: [
                { kind: 'motherboard', description: 'Gigabyte B650M Gaming WiFi' },
                { kind: 'memory', description: 'Kingston Fury Beast DDR4 16GB' },
              ],
            },
          },
        ],
      },
      { content: 'Opa! A memoria DDR4 nao e compativel com a placa B650M (usa DDR5).' },
    ];
    const { handler, sessionStore } = buildHandler(script as ReturnType<typeof fullPurchaseScript>);

    await handler.processInbound(mockSuriInbound());

    const session = await sessionStore.get('TKT-1001');
    expect(session?.botState).toBe(BotStateId.HARDWARE_CHECK);
    expect(session?.lastCompatibility?.compatible).toBe(false);
  });
});

describe('PaymentWebhookProcessor - PIX aprovado', () => {
  it('confirma pagamento, cria pedido "Aguardando NF" e atualiza o SURI', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPaymentPendingSession(sessionStore, erp);

    const suriCalls: string[] = [];
    const suri = {
      updateTicket: async () => {
        suriCalls.push('updateTicket');
      },
      sendReply: async () => {
        suriCalls.push('sendReply');
      },
    };
    const paymentClient = {
      handleNotification: async (rawBody: string, signature?: string) => {
        expect(signature).toBe('sig-pix');
        return JSON.parse(rawBody) as PaymentNotification;
      },
    };

    const processor = new PaymentWebhookProcessor({
      paymentClient: paymentClient as never,
      erpClient: erp as never,
      suriApi: suri as never,
      sessionStore,
    });

    const notification = pixApprovedNotification();
    const result = await processor.process(JSON.stringify(notification), 'sig-pix');

    expect(result.orderStatus).toBe('awaiting_nf');
    expect(result.botState).toBe(BotStateId.PAYMENT_CONFIRMED);

    const session = await sessionStore.get('TKT-1001');
    expect(session?.botState).toBe(BotStateId.PAYMENT_CONFIRMED);
    expect(session?.orderId).toBeDefined();

    expect(erp.ordersCreated).toHaveLength(1);
    const order = erp.ordersCreated[0] as {
      paymentMethod: string;
      status: string;
      totalCents: number;
      lines: unknown[];
    };
    expect(order.paymentMethod).toBe('pix');
    expect(order.status).toBe('awaiting_nf');
    expect(order.totalCents).toBe(notification.amountCents);
    expect(order.lines).toHaveLength(2);

    expect(suriCalls).toEqual(['updateTicket', 'sendReply']);
  });
});

describe('PaymentWebhookProcessor - Cartao de Credito aprovado', () => {
  it('confirma pagamento com cartao e cria pedido', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPaymentPendingSession(sessionStore, erp);

    const processor = new PaymentWebhookProcessor({
      paymentClient: {
        handleNotification: async (rawBody: string) => JSON.parse(rawBody) as PaymentNotification,
      } as never,
      erpClient: erp as never,
      suriApi: { updateTicket: async () => undefined, sendReply: async () => undefined } as never,
      sessionStore,
    });

    const notification = creditCardApprovedNotification({ ticketId: 'TKT-1001' });
    const result = await processor.process(JSON.stringify(notification));

    expect(result.orderStatus).toBe('awaiting_nf');
    expect(result.botState).toBe(BotStateId.PAYMENT_CONFIRMED);
    expect(erp.ordersCreated).toHaveLength(1);
  });

  it('rejeita notificacao de pagamento nao confirmado', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPaymentPendingSession(sessionStore, erp);

    const processor = new PaymentWebhookProcessor({
      paymentClient: {
        handleNotification: async (rawBody: string) => JSON.parse(rawBody) as PaymentNotification,
      } as never,
      erpClient: erp as never,
      suriApi: { updateTicket: async () => undefined, sendReply: async () => undefined } as never,
      sessionStore,
    });

    await expect(
      processor.process(
        JSON.stringify(
          pixApprovedNotification({ event: 'payment.refused', paidAt: undefined }),
        ),
      ),
    ).rejects.toThrow(/nao confirmado/);
  });
});

async function seedPaymentPendingSession(
  sessionStore: InMemorySessionStore,
  erp: MockErpAdapter,
): Promise<void> {
  const lock1 = await erp.lockItem('CPU-8600G', 1);
  const lock2 = await erp.lockItem('MB-B650M', 1);
  await sessionStore.save({
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
    lockIds: [lock1.lockId, lock2.lockId],
    updatedAt: new Date().toISOString(),
  });
}
