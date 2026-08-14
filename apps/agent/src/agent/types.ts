import type { AgentInbound, AgentBotResponse } from '../types/index.js';
import type { BotStateId } from '../fsm/states.js';

// ============================================================================
// Dominio do agente: sessao, carrinho, compatibilidade e intencao.
// ============================================================================

export interface CartItem {
  sku: string;
  name?: string;
  quantity: number;
  unitPriceCents: number;
  lockId?: string;
  lockExpiresAt?: string;
}

export interface CartSummary {
  items: CartItem[];
  subtotalCents: number;
  freightCents: number;
  totalCents: number;
  zipCode?: string;
  freightDetail?: { method: string; estimatedDays: number; cep: string };
}

export interface CompatibilityCheck {
  id: 'cpu_socket' | 'psu_tdp' | 'memory_type' | 'case_gpu' | 'other';
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
  message: string;
}

export interface CompatibilityReport {
  compatible: boolean;
  checks: CompatibilityCheck[];
  summary: string;
}

export interface WishItem {
  /** SKU quando conhecido; caso contrario texto livre descritivo. */
  sku?: string;
  description?: string;
  quantity: number;
}

export type CustomerIntent =
  | 'purchase' // quer comprar / montar equipamento
  | 'hardware_check' // pergunta de compatibilidade
  | 'cart_quote' // pergunta de preco, estoque, frete
  | 'payment_status' // quer saber sobre pagamento
  | 'track_order' // quer saber o status de um pedido
  | 'greeting' // saudacao / inicio
  | 'handoff'; // quer falar com humano

export interface SessionMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface SessionState {
  ticketId: string;
  botState: BotStateId;
  customerId: string;
  /** Dados do cliente (para eventos de CRM/ERP). */
  customerName?: string;
  customerPhone?: string;
  intent?: CustomerIntent;
  wishlist: WishItem[];
  cart: CartSummary | null;
  lastCompatibility?: CompatibilityReport;
  charge?: { method: 'pix' | 'credit_card'; chargeId: string; status: string };
  /** Momento em que a cobranca PIX expira (para o job de expiracao). */
  chargeExpiresAt?: string;
  orderId?: string;
  lastTrackedOrder?: {
    orderId: string;
    status: string;
    totalCents?: number;
    paymentMethod?: string;
    createdAt?: string;
  };
  lockIds: string[];
  /** Historico recente das mensagens trocadas no WhatsApp (para contexto do LLM). */
  recentMessages?: SessionMessage[];
  updatedAt: string;
}

export interface SessionStore {
  get(ticketId: string): Promise<SessionState | null>;
  save(session: SessionState): Promise<void>;
  delete(ticketId: string): Promise<void>;
  /** Lista todas as sessoes (usado pelo job de expiracao de PIX). */
  all?(): Promise<SessionState[]> | SessionState[];
  /** Localiza uma sessao pelo id do pedido (rastreamento). */
  findByOrderId?(orderId: string): Promise<SessionState | null> | SessionState | null;
}

/** Alias de convencao (Fase 2): interface da camada de persistencia de sessao. */
export type ISessionStore = SessionStore;

export interface MessageHandlerDeps {
  sessionStore: SessionStore;
  processInbound(inbound: AgentInbound): Promise<AgentBotResponse>;
}
