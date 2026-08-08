import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../src/config/env.js';
import { LLMProviderRouter } from '../src/llm/LLMProviderRouter.js';
import { KnowledgeBase } from '../src/rag/knowledgeBase.js';
import { MessageHandler } from '../src/agent/MessageHandler.js';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import {
  CartCalculatorSkill,
  defaultFreightCalculator,
  HardwareCompatibilitySkill,
  ProductSpecResolver,
  ToolRegistry,
} from '../src/agent/ToolRegistry.js';
import { PaymentWebhookProcessor } from '../src/integration/payment/PaymentWebhookProcessor.js';
import { PaymentClient } from '../src/integration/payment/PaymentClient.js';
import { SuriApi } from '../src/integration/suri/SuriApi.js';
import { MockErpAdapter } from '../tests/mocks/erp.js';
import type { ErpClient } from '../src/integration/erp/ErpClient.js';
import type { SuriInbound } from '../src/types/index.js';

const envLines = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
for (const line of envLines.split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const env = loadEnv();

const okFetch = (async () =>
  new Response(
    JSON.stringify({ received: true, processed: true, orderId: 'ORDER-E2E-1', status: 'awaiting_nf' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;

const erp = new MockErpAdapter();
const sessionStore = new InMemorySessionStore();
const knowledgeBase = new KnowledgeBase();

const router = new LLMProviderRouter({
  primary: env.groq,
  fallback: env.gemini,
  onProviderChange: (e) => {
    console.log(`\n[provider] ${e.from} -> ${e.to} (${e.reason})`);
  },
});

const cartSkill = new CartCalculatorSkill(
  { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
  defaultFreightCalculator,
);
const hardwareSkill = new HardwareCompatibilitySkill({
  resolver: new ProductSpecResolver({ knowledgeBase, stockBySku: (s) => erp.stockBySku(s) }),
});
const tools = new ToolRegistry({ hardwareCompatibility: hardwareSkill, cartCalculator: cartSkill });

const handler = new MessageHandler({ router, tools, sessionStore, knowledgeBase });

const paymentWebhook = new PaymentWebhookProcessor({
  paymentClient: new PaymentClient({ baseURL: 'http://gateway.test', apiKey: 'test', fetchImpl: okFetch }),
  erpClient: erp as unknown as ErpClient,
  suriApi: new SuriApi({ baseURL: 'http://suri.test', webhookToken: 'test', fetchImpl: okFetch }),
  sessionStore,
});

const ticketId = 'TKT-E2E-REAL';

function inbound(text: string, n: number): SuriInbound {
  return {
    event: 'message',
    channel: 'whatsapp',
    ticketId,
    customer: { id: 'CUST-E2E', phone: '+5511987654321', name: 'Cliente E2E' },
    message: {
      id: `MSG-${n}-${randomUUID()}`,
      type: 'text',
      text,
      timestamp: new Date().toISOString(),
    },
    context: { ticketId, locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    receivedAt: new Date().toISOString(),
  };
}

async function state() {
  const s = await sessionStore.get(ticketId);
  return {
    botState: s?.botState,
    cart: s?.cart,
    order: s?.order,
  };
}

console.log('=== E2E REAL (Groq primario, Gemini fallback) ===');
console.log(`primario=${env.groq.name}/${env.groq.model} | fallback=${env.gemini.name}/${env.gemini.model}`);

console.log('\n--- MSG 1: pedido completo com SKUs + CEP ---');
const r1 = await handler.processInbound(
  inbound(
    'Ola, quero montar um PC gamer. Pecas: Processador AMD Ryzen 5 8600G (SKU CPU-8600G) x1; ' +
      'Placa mae Gigabyte B650M Gaming WiFi (SKU MB-B650M) x1; ' +
      'Memoria Kingston Fury Beast DDR5 6000 16GB (SKU MEM-DDR5-16) x2; ' +
      'Fonte Corsair RM650x 650W (SKU PSU-650) x1; ' +
      'Gabinete Corsair 4000D Airflow (SKU CASE-4000D) x1; ' +
      'Placa de video RTX 4060 Ti 16GB (SKU GPU-RTX4060TI) x1. ' +
      'CEP para frete: 01310100. Quero saber se e compativel e o total final com frete.',
    1,
  ),
);
console.log('[bot]', r1.reply.text);
console.log('[state]', JSON.stringify(await state(), null, 2));

console.log('\n--- MSG 2: confirmacao de pagamento PIX ---');
const r2 = await handler.processInbound(inbound('Perfeito, quero pagar via PIX, manda o QR code.', 2));
console.log('[bot]', r2.reply.text);
console.log('[state]', JSON.stringify(await state(), null, 2));

console.log('\n--- WEBHOOK: pagamento PIX confirmado ---');
const session = await sessionStore.get(ticketId);
const body = JSON.stringify({
  event: 'payment.confirmed',
  method: 'pix',
  chargeId: 'CHARGE-E2E-1',
  orderId: session?.order?.id ?? 'ORDER-E2E-1',
  ticketId,
  amountCents: session?.cart?.totalCents ?? 1,
  paidAt: new Date().toISOString(),
  pix: { txid: 'TXID-E2E-1', endToEndId: 'E2E-1' },
});
const w = await paymentWebhook.process(body);
console.log('[webhook]', JSON.stringify(w, null, 2));
console.log('[state final]', JSON.stringify(await state(), null, 2));
console.log('\n=== E2E REAL CONCLUIDO ===');
