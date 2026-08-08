import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../src/server.js';
import { createPaymentExpiryJob } from '../src/agent/paymentExpiryJob.js';
import { createChargeOnTransition } from '../src/agent/chargeOnTransition.js';
import { MessageHandler } from '../src/agent/MessageHandler.js';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import { PaymentWebhookProcessor } from '../src/integration/payment/PaymentWebhookProcessor.js';
import { PaymentClient } from '../src/integration/payment/PaymentClient.js';
import { CrmClient, CrmRequestError } from '../src/integrations/crm/CrmClient.js';
import type { ICrmClient } from '../src/integrations/crm/CrmClient.js';
import { CrmFollowUpHandler } from '../src/webhooks/crm.js';
import {
  crmEventSchema,
  crmFollowUpSchema,
  crmLeadCreatedSchema,
  crmPixExpiredSchema,
  crmPixGeneratedSchema,
  crmSaleCompletedSchema,
} from '../src/integrations/crm/types.js';
import type { CrmEvent, CrmFollowUp } from '../src/integrations/crm/types.js';
import { SuriApi } from '../src/integration/suri/SuriApi.js';
import { BotStateId } from '../src/fsm/states.js';
import { BotStateMachine } from '../src/fsm/BotStateMachine.js';
import { ToolRegistry, CartCalculatorSkill, HardwareCompatibilitySkill, ProductSpecResolver, defaultFreightCalculator } from '../src/agent/ToolRegistry.js';
import { KnowledgeBase } from '../src/rag/knowledgeBase.js';
import { MockErpAdapter } from './mocks/erp.js';
import { mockSuriInbound, pixApprovedNotification, ScriptedRouter } from './mocks/events.js';
import type { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import type { SessionState } from '../src/agent/types.js';
import type { AppContainer } from '../src/container.js';

// ============================================================================
// FASE 4 - CRM (trycompai/crm)
// Cobertura: schemas Zod, CrmClient (timeout/disabled/erro), emissao de
// eventos nos orquestradores e webhook de follow-up.
// ============================================================================

class RecordingCrmClient implements ICrmClient {
  readonly enabled = true;
  readonly events: CrmEvent[] = [];
  private readonly fail: boolean;

  constructor(fail = false) {
    this.fail = fail;
  }

  async sendEvent(event: CrmEvent): Promise<{ delivered: boolean; event: CrmEvent['event']; statusCode: number }> {
    if (this.fail) throw new Error('CRM indisponivel');
    this.events.push(event);
    return { delivered: true, event: event.event, statusCode: 200 };
  }
}

const nowIso = () => new Date().toISOString();

function seedPendingPayment(
  sessionStore: InMemorySessionStore,
  erp: MockErpAdapter,
  overrides: Partial<SessionState> = {},
): Promise<SessionState> {
  return (async () => {
    const lock1 = await erp.lockItem('CPU-8600G', 1);
    const lock2 = await erp.lockItem('MB-B650M', 1);
    const session: SessionState = {
      ticketId: 'TKT-P1',
      botState: BotStateId.PAYMENT_PENDING,
      customerId: 'CUST-42',
      customerName: 'Cliente Teste',
      customerPhone: '5511999990000',
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
      ...overrides,
    };
    await sessionStore.save(session);
    return session;
  })();
}

describe('CRM - schemas Zod dos eventos de ciclo de vida', () => {
  it('valida lead.created com cliente, intencao e wishlist', () => {
    const event = crmLeadCreatedSchema.parse({
      event: 'lead.created',
      ticketId: 'TKT-1',
      customer: { id: 'C-1', name: 'Ana', phone: '5511999990000' },
      intent: 'purchase',
      wishlist: [{ description: 'Ryzen 5 8600G', quantity: 1 }],
      estimatedValueCents: 272480,
      createdAt: nowIso(),
    });
    expect(event.event).toBe('lead.created');
    expect(event.customer.phone).toBe('5511999990000');
  });

  it('valida pix.generated, pix.expired e sale.completed', () => {
    const generated = crmPixGeneratedSchema.parse({
      event: 'pix.generated',
      ticketId: 'TKT-1',
      orderId: 'ORDER-1',
      chargeId: 'CHARGE-1',
      amountCents: 1000,
      qrCodeBase64: 'AAA',
      emv: '000201',
      expiresAt: nowIso(),
      createdAt: nowIso(),
    });
    expect(generated.qrCodeBase64).toBe('AAA');

    const expired = crmPixExpiredSchema.parse({
      event: 'pix.expired',
      ticketId: 'TKT-1',
      chargeId: 'CHARGE-1',
      amountCents: 1000,
      createdAt: nowIso(),
    });
    expect(expired.event).toBe('pix.expired');

    const completed = crmSaleCompletedSchema.parse({
      event: 'sale.completed',
      ticketId: 'TKT-1',
      orderId: 'ORDER-1',
      chargeId: 'CHARGE-1',
      amountCents: 1000,
      method: 'pix',
      createdAt: nowIso(),
    });
    expect(completed.method).toBe('pix');
  });

  it('rejeita nome de evento desconhecido (discriminated union)', () => {
    const bad = {
      event: 'charge.refunded',
      ticketId: 'TKT-1',
      createdAt: nowIso(),
    };
    expect(() => crmEventSchema.parse(bad)).toThrow();
  });

  it('valida o payload do follow-up', () => {
    const parsed = crmFollowUpSchema.parse({
      ticketId: 'TKT-1',
      reason: 'abandoned_cart',
      message: 'Volte!',
    }) as CrmFollowUp;
    expect(parsed.reason).toBe('abandoned_cart');
  });
});

describe('CrmClient - envio de eventos', () => {
  const event: CrmEvent = {
    event: 'lead.created',
    ticketId: 'TKT-1',
    customer: { id: 'C-1', phone: '5511999990000' },
    createdAt: nowIso(),
  };

  it('CRM_ENABLED=false => no-op silencioso sem chamar fetch', () => {
    let called = false;
    const client = new CrmClient({
      baseURL: 'http://crm.test',
      apiToken: 't',
      enabled: false,
      fetchImpl: (async () => {
        called = true;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    return client.sendEvent(event).then((result) => {
      expect(result).toEqual({ delivered: false, event: 'lead.created', skipped: 'disabled' });
      expect(called).toBe(false);
    });
  });

  it('envia POST /events com Bearer e retorna entregue', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const client = new CrmClient({
      baseURL: 'http://crm.test/api/v1',
      apiToken: 'secret-token',
      enabled: true,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        captured.push({ url, init });
        return new Response('{"ok":true}', { status: 201 });
      }) as typeof fetch,
    });

    const result = await client.sendEvent(event);
    expect(result).toMatchObject({ delivered: true, event: 'lead.created', statusCode: 201 });
    expect(captured[0]?.url).toBe('http://crm.test/api/v1/events');
    expect(captured[0]?.init?.method).toBe('POST');
    expect((captured[0]?.init?.headers as Record<string, string>)?.authorization).toBe(
      'Bearer secret-token',
    );
    const body = JSON.parse(String(captured[0]?.init?.body)) as CrmEvent;
    expect(body.event).toBe('lead.created');
  });

  it('status nao-2xx lanca CrmRequestError com status', async () => {
    const client = new CrmClient({
      baseURL: 'http://crm.test',
      apiToken: 't',
      enabled: true,
      fetchImpl: (async () => new Response('boom', { status: 500 })) as typeof fetch,
    });
    await expect(client.sendEvent(event)).rejects.toBeInstanceOf(CrmRequestError);
  });

  it('respeita timeout rigido (max 3000ms) abortando a chamada', async () => {
    const client = new CrmClient({
      baseURL: 'http://crm.test',
      apiToken: 't',
      enabled: true,
      timeoutMs: 30,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        })) as typeof fetch,
    });
    await expect(client.sendEvent(event)).rejects.toThrow('Aborted');
  });
});

describe('MessageHandler - emissao de lead.created', () => {
  it('emite lead.created ao sair de boas-vindas para montagem (intent purchase)', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    const knowledgeBase = new KnowledgeBase();
    const crm = new RecordingCrmClient();
    const tools = new ToolRegistry({
      hardwareCompatibility: new HardwareCompatibilitySkill({
        resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
      }),
      cartCalculator: new CartCalculatorSkill(
        { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
        defaultFreightCalculator,
      ),
    });
    const router = new ScriptedRouter([
      {
        toolCalls: [
          { id: 'c1', name: 'identify_intent', arguments: { intent: 'purchase', wishlist: [{ description: 'Ryzen 5 8600G', quantity: 1 }] } },
        ],
      },
      { content: 'Perfeito, vamos montar seu PC!' },
    ]) as unknown as LLMProviderRouter;

    const handler = new MessageHandler({ router, tools, sessionStore, knowledgeBase, crmClient: crm });
    await handler.processInbound(
      mockSuriInbound({
        ticketId: 'TKT-LEAD',
        customer: { id: 'CUST-1', phone: '5511988880000', name: 'Ana' },
      }),
    );

    expect(crm.events).toHaveLength(1);
    const lead = crm.events[0];
    expect(lead?.event).toBe('lead.created');
    if (lead?.event === 'lead.created') {
      expect(lead.ticketId).toBe('TKT-LEAD');
      expect(lead.customer.name).toBe('Ana');
      expect(lead.customer.phone).toBe('5511988880000');
      expect(lead.intent).toBe('purchase');
      expect(lead.wishlist).toHaveLength(1);
    }
  });

  it('NAO emite lead.created para transicoes que nao saem de boas-vindas', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    const knowledgeBase = new KnowledgeBase();
    const crm = new RecordingCrmClient();
    const tools = new ToolRegistry({
      hardwareCompatibility: new HardwareCompatibilitySkill({
        resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
      }),
      cartCalculator: new CartCalculatorSkill(
        { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
        defaultFreightCalculator,
      ),
    });
    await sessionStore.save({
      ticketId: 'TKT-H',
      botState: BotStateId.HARDWARE_CHECK,
      customerId: 'CUST-1',
      wishlist: [],
      cart: null,
      lockIds: [],
      updatedAt: new Date().toISOString(),
    });
    const router = new ScriptedRouter([
      { toolCalls: [{ id: 'c1', name: 'identify_intent', arguments: { intent: 'cart_quote' } }] },
      { content: 'ok' },
    ]) as unknown as LLMProviderRouter;

    const handler = new MessageHandler({ router, tools, sessionStore, knowledgeBase, crmClient: crm });
    await handler.processInbound(mockSuriInbound({ ticketId: 'TKT-H' }));
    expect(crm.events).toHaveLength(0);
  });
});

describe('createChargeOnTransition - emissao de pix.generated', () => {
  it('gera cobranca, grava na sessao e emite pix.generated', async () => {
    const crm = new RecordingCrmClient();
    const okFetch = (async (_url: string) =>
      new Response(
        JSON.stringify({
          chargeId: 'CHARGE-PIX-1',
          orderId: 'ORDER-1',
          status: 'pending',
          qrCode: 'data:image/png;base64,AAA',
          qrCodeBase64: 'AAA',
          emv: '00020126580014BR.GOV.BCB.PIX0136abc',
          expiresAt: '2026-08-06T12:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const payment = new PaymentClient({ baseURL: 'http://gateway.test', apiKey: 'k', fetchImpl: okFetch });
    const hook = createChargeOnTransition({ payment, crmClient: crm, expiresInMinutes: 30 });

    const session: SessionState = {
      ticketId: 'TKT-C',
      botState: BotStateId.STOCK_AND_FREIGHT,
      customerId: 'C-1',
      wishlist: [],
      cart: { items: [], subtotalCents: 0, freightCents: 0, totalCents: 1000 },
      lockIds: [],
      updatedAt: nowIso(),
    };
    const fsm = new BotStateMachine({ initialState: BotStateId.STOCK_AND_FREIGHT });
    fsm.transition({ type: 'CART_READY' });

    await hook(session, fsm);

    expect(session.charge?.chargeId).toBe('CHARGE-PIX-1');
    expect(session.chargeExpiresAt).toBe('2026-08-06T12:00:00.000Z');
    expect(crm.events).toHaveLength(1);
    const ev = crm.events[0];
    expect(ev?.event).toBe('pix.generated');
    if (ev?.event === 'pix.generated') {
      expect(ev.amountCents).toBe(1000);
      expect(ev.expiresAt).toBe('2026-08-06T12:00:00.000Z');
    }
  });

  it('falha no gateway NAO emite evento e NAO lanca para o chamador', async () => {
    const crm = new RecordingCrmClient();
    const failingFetch = (async () => new Response('erro', { status: 500 })) as typeof fetch;
    const payment = new PaymentClient({ baseURL: 'http://gateway.test', apiKey: 'k', fetchImpl: failingFetch });
    const hook = createChargeOnTransition({ payment, crmClient: crm, expiresInMinutes: 30 });

    const session: SessionState = {
      ticketId: 'TKT-C2',
      botState: BotStateId.STOCK_AND_FREIGHT,
      customerId: 'C-1',
      wishlist: [],
      cart: { items: [], subtotalCents: 0, freightCents: 0, totalCents: 1000 },
      lockIds: [],
      updatedAt: nowIso(),
    };
    const fsm = new BotStateMachine({ initialState: BotStateId.STOCK_AND_FREIGHT });
    fsm.transition({ type: 'CART_READY' });

    await expect(hook(session, fsm)).resolves.toBeUndefined();
    expect(session.charge).toBeUndefined();
    expect(crm.events).toHaveLength(0);
  });
});

describe('PaymentWebhookProcessor - emissao de sale.completed e pix.expired', () => {
  function buildProcessor(sessionStore: InMemorySessionStore, erp: MockErpAdapter, crm: RecordingCrmClient) {
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
      handleNotification: async () => pixApprovedNotification({ ticketId: 'TKT-P1', amountCents: 272480 }),
    };
    const processor = new PaymentWebhookProcessor({
      paymentClient: paymentClient as never,
      erpClient: erp as never,
      suriApi: suri as never,
      sessionStore,
      crmClient: crm,
    });
    return { processor, suriCalls };
  }

  it('process() confirma pagamento e emite sale.completed', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPendingPayment(sessionStore, erp);
    const crm = new RecordingCrmClient();
    const { processor } = buildProcessor(sessionStore, erp, crm);

    const result = await processor.process(JSON.stringify(pixApprovedNotification({ ticketId: 'TKT-P1' })));
    expect(result.orderStatus).toBe('awaiting_nf');

    expect(crm.events).toHaveLength(1);
    const ev = crm.events[0];
    expect(ev?.event).toBe('sale.completed');
    if (ev?.event === 'sale.completed') {
      expect(ev.orderId).toBe(result.orderId);
      expect(ev.method).toBe('pix');
      expect(ev.amountCents).toBe(272480);
    }
  });

  it('expire() libera estoque e emite pix.expired', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPendingPayment(sessionStore, erp);
    const crm = new RecordingCrmClient();
    const { processor } = buildProcessor(sessionStore, erp, crm);

    const result = await processor.expire('TKT-P1');
    expect(result.status).toBe('expired');

    expect(crm.events).toHaveLength(1);
    const ev = crm.events[0];
    expect(ev?.event).toBe('pix.expired');
    if (ev?.event === 'pix.expired') {
      expect(ev.chargeId).toBe('CHARGE-1');
      expect(ev.amountCents).toBe(272480);
    }
  });

  it('cancel() NAO emite pix.expired', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPendingPayment(sessionStore, erp);
    const crm = new RecordingCrmClient();
    const { processor } = buildProcessor(sessionStore, erp, crm);

    await processor.cancel('TKT-P1');
    expect(crm.events).toHaveLength(0);
  });

  it('falha de comunicacao com o CRM nao interrompe a confirmacao (fire-and-forget)', async () => {
    const erp = new MockErpAdapter();
    const sessionStore = new InMemorySessionStore();
    await seedPendingPayment(sessionStore, erp);
    const crm = new RecordingCrmClient(true);
    const { processor } = buildProcessor(sessionStore, erp, crm);

    const result = await processor.process(JSON.stringify(pixApprovedNotification({ ticketId: 'TKT-P1' })));
    expect(result.orderStatus).toBe('awaiting_nf');
    const session = await sessionStore.get('TKT-P1');
    expect(session?.botState).toBe(BotStateId.PAYMENT_CONFIRMED);
  });
});

describe('CrmFollowUpHandler - webhook de reengajamento', () => {
  function build() {
    const sessionStore = new InMemorySessionStore();
    const sent: Array<{ ticketId: string; text: string }> = [];
    const suri = {
      sendReply: async (reply: { ticketId: string; text: string }) => {
        sent.push(reply);
      },
    } as never as SuriApi;
    const handler = new CrmFollowUpHandler({ sessionStore, suriApi: suri });
    return { sessionStore, suri, handler, sent };
  }

  it('dispara mensagem padrao de carrinho abandonado', async () => {
    const { sessionStore, handler, sent } = build();
    await sessionStore.save({
      ticketId: 'TKT-FU',
      botState: BotStateId.STOCK_AND_FREIGHT,
      customerId: 'C-1',
      wishlist: [],
      cart: null,
      lockIds: [],
      updatedAt: new Date().toISOString(),
    });

    const result = await handler.handle(JSON.stringify({ ticketId: 'TKT-FU', reason: 'abandoned_cart' }));
    expect(result.ok).toBe(true);
    expect(result.botState).toBe(BotStateId.STOCK_AND_FREIGHT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.ticketId).toBe('TKT-FU');
    expect(sent[0]?.text).toContain('carrinho');
  });

  it('usa a mensagem customizada do payload quando presente', async () => {
    const { sessionStore, handler, sent } = build();
    await sessionStore.save({
      ticketId: 'TKT-FU2',
      botState: BotStateId.PAYMENT_PENDING,
      customerId: 'C-2',
      wishlist: [],
      cart: null,
      lockIds: [],
      updatedAt: new Date().toISOString(),
    });

    const result = await handler.handle(
      JSON.stringify({ ticketId: 'TKT-FU2', reason: 'manual', message: 'Volte correndo! Oferta especial.' }),
    );
    expect(result.ok).toBe(true);
    expect(sent[0]?.text).toBe('Volte correndo! Oferta especial.');
  });

  it('retorna session_not_found sem disparar mensagem', async () => {
    const { handler, sent } = build();
    const result = await handler.handle(JSON.stringify({ ticketId: 'TKT-FU3', reason: 'abandoned_cart' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('session_not_found');
    expect(sent).toHaveLength(0);
  });

  it('rejeita payload invalido (Zod)', async () => {
    const { handler } = build();
    await expect(handler.handle(JSON.stringify({ reason: 'abandoned_cart' }))).rejects.toThrow();
  });
});

describe('Server HTTP - POST /webhooks/crm/follow-up', () => {
  async function startServer() {
    const sessionStore = new InMemorySessionStore();
    await sessionStore.save({
      ticketId: 'TKT-SRV',
      botState: BotStateId.STOCK_AND_FREIGHT,
      customerId: 'C-1',
      wishlist: [],
      cart: null,
      lockIds: [],
      updatedAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    const suri = {
      sendReply: async (r: { ticketId: string }) => {
        sent.push(r.ticketId);
      },
    } as never as SuriApi;
    const crmFollowUp = new CrmFollowUpHandler({ sessionStore, suriApi: suri });
    const container = {
      paymentExpiryJob: createPaymentExpiryJob({ sessionStore, expire: async () => undefined }),
      crmFollowUp,
    } as unknown as AppContainer;

    const server = createAppServer(0, container);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      base: `http://127.0.0.1:${port}`,
      sent,
      stop: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    };
  }

  it('200 quando a sessao existe e mensagem e disparada', async () => {
    const app = await startServer();
    try {
      const res = await fetch(`${app.base}/webhooks/crm/follow-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: 'TKT-SRV', reason: 'abandoned_cart' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; botState: string };
      expect(body.ok).toBe(true);
      expect(body.botState).toBe(BotStateId.STOCK_AND_FREIGHT);
      expect(app.sent).toContain('TKT-SRV');
    } finally {
      await app.stop();
    }
  });

  it('404 quando a sessao nao existe', async () => {
    const app = await startServer();
    try {
      const res = await fetch(`${app.base}/webhooks/crm/follow-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: 'TKT-NAO-EXISTE', reason: 'manual' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await app.stop();
    }
  });

  it('400 quando o payload e invalido', async () => {
    const app = await startServer();
    try {
      const res = await fetch(`${app.base}/webhooks/crm/follow-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"payload": invalido}',
      });
      expect(res.status).toBe(400);
    } finally {
      await app.stop();
    }
  });
});
