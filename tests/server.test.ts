import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../src/server.js';
import type { AppContainer } from '../src/container.js';
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
import { createPaymentExpiryJob } from '../src/agent/paymentExpiryJob.js';
import { PaymentClient } from '../src/integration/payment/PaymentClient.js';
import { PaymentWebhookProcessor } from '../src/integration/payment/PaymentWebhookProcessor.js';
import { SuriApi } from '../src/integration/suri/SuriApi.js';
import { BotStateId } from '../src/fsm/states.js';
import { MockErpAdapter } from './mocks/erp.js';
import {
  fullPurchaseScript,
  mockSuriInbound,
  pixApprovedNotification,
  ScriptedRouter,
} from './mocks/events.js';
import type { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';

interface TestApp {
  base: string;
  server: ReturnType<typeof createAppServer>;
  container: AppContainer;
  erp: MockErpAdapter;
  sessionStore: InMemorySessionStore;
  suriCalls: string[];
  stop(): Promise<void>;
}

async function startApp(script: ReturnType<typeof fullPurchaseScript> = fullPurchaseScript()): Promise<TestApp> {
  const erp = new MockErpAdapter();
  const sessionStore = new InMemorySessionStore();
  const knowledgeBase = new KnowledgeBase();
  const metrics = new Metrics();
  const suriCalls: string[] = [];

  const okFetch = (async (url: string, init?: RequestInit) => {
    suriCalls.push(`${init?.method ?? 'GET'} ${url}`);
    const body = url.includes('/notifications/ack')
      ? { received: true, processed: true, orderId: 'ORDER-ACK', status: 'awaiting_nf' }
      : { ok: true };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const paymentClient = new PaymentClient({
    baseURL: 'http://gateway.test',
    apiKey: 'k',
    webhookSecret: 'segredo',
    fetchImpl: okFetch,
  });
  const suri = new SuriApi({ baseURL: 'http://suri.test', webhookToken: 't', fetchImpl: okFetch });

  const tools = new ToolRegistry({
    hardwareCompatibility: new HardwareCompatibilitySkill({
      resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
    }),
    cartCalculator: new CartCalculatorSkill(
      { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
      defaultFreightCalculator,
    ),
  });

  const router = new ScriptedRouter(script) as unknown as LLMProviderRouter;
  const handler = new MessageHandler({ router, tools, sessionStore, knowledgeBase, metrics });
  const paymentWebhook = new PaymentWebhookProcessor({
    paymentClient,
    erpClient: erp as never,
    suriApi: suri,
    sessionStore,
    metrics,
  });
  const paymentExpiryJob = createPaymentExpiryJob({
    sessionStore,
    expire: (t) => paymentWebhook.expire(t),
  });

  const container = {
    router,
    handler,
    erp: erp as never,
    payment: paymentClient,
    paymentWebhook,
    suri,
    sessionStore,
    knowledgeBase,
    metrics,
    paymentExpiryJob,
  } as unknown as AppContainer;

  const server = createAppServer(0, container);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    server,
    container,
    erp,
    sessionStore,
    suriCalls,
    stop: () =>
      new Promise<void>((resolve) => {
        container.paymentExpiryJob.stop();
        server.close(() => resolve());
      }),
  };
}

describe('Server HTTP - health e endpoints webhook (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  it('GET /health reporta provider, circuito e status da SessionStore', async () => {
    const res = await fetch(`${app.base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      provider: string;
      sessionStore: { type: string; size: number };
    };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('scripted');
    expect(body.sessionStore.type).toBe('memory');
    expect(body.sessionStore.size).toBe(0);
  });

  it('POST /webhooks/suri processa a mensagem, persiste a sessao e responde ao SURI', async () => {
    const res = await fetch(`${app.base}/webhooks/suri`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mockSuriInbound()),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { reply: { ticketId: string }; ticketUpdate?: { status: string } };
    expect(body.reply.ticketId).toBe('TKT-1001');
    expect(body.ticketUpdate?.status).toBe('awaiting_payment');

    const session = await app.sessionStore.get('TKT-1001');
    expect(session?.botState).toBe(BotStateId.PAYMENT_PENDING);
    expect(session?.recentMessages).toHaveLength(2);
    expect(session?.recentMessages?.[0]).toMatchObject({ role: 'user' });

    const snapshot = app.container.metrics.snapshot();
    expect(snapshot.transitions['GREETING->HARDWARE_CHECK']).toBe(1);
  });

  it('POST /webhooks/suri rejeita corpo invalido com 400', async () => {
    const res = await fetch(`${app.base}/webhooks/suri`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"payload": invalido}',
    });
    expect(res.status).toBe(400);
  });

  it('POST /webhooks/payment confirma o PIX, cria pedido e notifica o SURI', async () => {
    await seedPending(app.sessionStore, app.erp);
    const rawBody = JSON.stringify(
      pixApprovedNotification({ ticketId: 'TKT-1001', amountCents: 272480 }),
    );
    const signature = 'sha256=' + createHmac('sha256', 'segredo').update(rawBody).digest('hex');

    const res = await fetch(`${app.base}/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signature },
      body: rawBody,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { orderStatus: string; botState: string };
    expect(body.orderStatus).toBe('awaiting_nf');
    expect(body.botState).toBe(BotStateId.PAYMENT_CONFIRMED);

    const session = await app.sessionStore.get('TKT-1001');
    expect(session?.botState).toBe(BotStateId.PAYMENT_CONFIRMED);
    expect(session?.orderId).toBeDefined();
    expect(app.erp.ordersCreated).toHaveLength(1);
    expect(app.suriCalls.some((c) => c.includes('/messages'))).toBe(true);
    expect(app.suriCalls.some((c) => c.includes('/tickets/'))).toBe(true);
  });

  it('POST /webhooks/payment rejeita assinatura invalida com 400', async () => {
    const rawBody = JSON.stringify(pixApprovedNotification());
    const res = await fetch(`${app.base}/webhooks/payment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'sha256=assinatura-errada',
      },
      body: rawBody,
    });
    expect(res.status).toBe(400);
  });

  it('GET /metrics expoe o formato Prometheus', async () => {
    const res = await fetch(`${app.base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('llm_calls_total');
    expect(text).toContain('fsm_transitions_total');
  });

  it('retorna 404 para rotas desconhecidas', async () => {
    const res = await fetch(`${app.base}/rota-inexistente`);
    expect(res.status).toBe(404);
  });
});

async function seedPending(
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
    recentMessages: [],
    updatedAt: new Date().toISOString(),
  });
}
