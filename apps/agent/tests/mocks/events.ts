import type { AgentInbound } from '../src/types/index.js';
import type { PaymentNotification } from '../src/types/index.js';
import type { LlmResult, LlmToolCall } from '../src/llm/types.js';

// ============================================================================
// MOCKS DE TESTE
// Eventos para simular: compra aprovada por PIX, compra aprovada por cartao de
// credito e fallback da IA. Tambem monta payloads brutos de webhook da
// Evolution API (evento "messages.upsert").
// ============================================================================

export function mockAgentInbound(overrides: Partial<AgentInbound> = {}): AgentInbound {
  return {
    event: 'message',
    channel: 'whatsapp',
    ticketId: '5511999990000',
    customer: { id: 'CUST-42', phone: '5511999990000', name: 'Cliente Teste' },
    message: {
      id: 'MSG-1',
      type: 'text',
      text: 'Oi, quero montar um PC gamer',
      timestamp: new Date().toISOString(),
    },
    context: { locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

// --- Payload bruto do webhook da Evolution API (evento "messages.upsert") ---
export interface EvolutionMessagePayload {
  event: 'messages.upsert';
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe?: boolean;
      id: string;
      participant?: string;
    };
    message?: Record<string, unknown>;
    messageType?: string;
    pushName?: string;
    timestamp?: number;
  };
}

export function mockEvolutionMessage(
  text: string,
  overrides: Partial<EvolutionMessagePayload['data']> = {},
): string {
  const remoteJid = overrides.key?.remoteJid ?? '5511999990000@s.whatsapp.net';
  const payload: EvolutionMessagePayload = {
    event: 'messages.upsert',
    instance: 'loja',
    data: {
      key: {
        remoteJid,
        fromMe: false,
        id: `WAM-${Date.now()}`,
      },
      message: { conversation: text },
      messageType: 'conversation',
      pushName: 'Cliente Teste',
      timestamp: Math.floor(Date.now() / 1000),
      ...overrides,
    },
  };
  return JSON.stringify(payload);
}

// --- Compra aprovada por PIX -------------------------------------------------
export function pixApprovedNotification(overrides: Partial<PaymentNotification> = {}): PaymentNotification {
  return {
    event: 'payment.confirmed',
    method: 'pix',
    chargeId: 'CHARGE-PIX-1',
    orderId: 'ORDER-7001',
    ticketId: 'TKT-1001',
    amountCents: 599990,
    paidAt: new Date().toISOString(),
    pix: { txid: 'TXID-ABC123', endToEndId: 'E2E-98765' },
    ...overrides,
  };
}

// --- Compra aprovada por Cartao de Credito ----------------------------------
export function creditCardApprovedNotification(
  overrides: Partial<PaymentNotification> = {},
): PaymentNotification {
  return {
    event: 'payment.confirmed',
    method: 'credit_card',
    chargeId: 'CHARGE-CC-1',
    orderId: 'ORDER-7002',
    ticketId: 'TKT-2002',
    amountCents: 129990,
    paidAt: new Date().toISOString(),
    installments: 3,
    ...overrides,
  };
}

// --- Fallback da IA: script para o roteador ---------------------------------
export interface ScriptedCall {
  toolCalls?: LlmToolCall[];
  content?: string;
  throwError?: Error;
}

// Router fake que reproduz a sequencia de tool calls esperada pelo agente.
export class ScriptedRouter {
  private readonly queue: ScriptedCall[];
  calls = 0;

  constructor(calls: ScriptedCall[]) {
    this.queue = [...calls];
  }

  get activeProvider(): string {
    return 'scripted';
  }

  get state(): {
    activeProvider: string;
    fallbackActive: boolean;
    circuitOpen: boolean;
    circuitOpenUntil: number;
  } {
    return {
      activeProvider: 'scripted',
      fallbackActive: false,
      circuitOpen: false,
      circuitOpenUntil: 0,
    };
  }

  async chat(): Promise<LlmResult> {
    const next = this.queue.shift();
    if (!next) throw new Error('ScriptedRouter: fila esgotada');
    this.calls += 1;
    if (next.throwError) throw next.throwError;
    return {
      content: next.content ?? null,
      toolCalls: next.toolCalls ?? [],
      provider: 'scripted',
      model: 'mock',
    };
  }
}

// Fila tipica do fluxo completo: intencao -> compatibilidade -> carrinho -> resposta
export function fullPurchaseScript(): ScriptedCall[] {
  return [
    {
      toolCalls: [
        {
          id: 'call-intent',
          name: 'identify_intent',
          arguments: {
            intent: 'purchase',
            wishlist: [
              { description: 'AMD Ryzen 5 8600G', quantity: 1 },
              { description: 'Gigabyte B650M Gaming WiFi', quantity: 1 },
              { description: 'Kingston Fury Beast DDR5 16GB', quantity: 2 },
              { description: 'Corsair RM650x 650W', quantity: 1 },
              { description: 'Corsair 4000D Airflow', quantity: 1 },
            ],
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
              { kind: 'cpu', description: 'AMD Ryzen 5 8600G' },
              { kind: 'motherboard', description: 'Gigabyte B650M Gaming WiFi' },
              { kind: 'memory', description: 'Kingston Fury Beast DDR5 16GB' },
              { kind: 'psu', description: 'Corsair RM650x 650W' },
              { kind: 'gpu', description: 'RTX 4060 Ti 16GB' },
              { kind: 'case', description: 'Corsair 4000D Airflow' },
            ],
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'call-cart',
          name: 'calculate_cart',
          arguments: {
            skus: [
              { sku: 'CPU-8600G', quantity: 1 },
              { sku: 'MB-B650M', quantity: 1 },
              { sku: 'MEM-DDR5-16', quantity: 2 },
              { sku: 'PSU-650', quantity: 1 },
              { sku: 'CASE-4000D', quantity: 1 },
            ],
            zipCode: '01310100',
            lockItems: true,
          },
        },
      ],
    },
    {
      content:
        'Sua configuracao e compativel! O total ficou R$ 5.999,90 (com frete). Quer seguir para o pagamento via PIX ou cartao de credito?',
    },
  ];
}
