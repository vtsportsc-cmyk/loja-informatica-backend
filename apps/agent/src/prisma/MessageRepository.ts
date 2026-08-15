import { Department, FunnelStatus } from '@loja/db';
import type { PrismaClient } from '@loja/db';

// ============================================================================
// Camada de persistencia de conversas/mensagens no PostgreSQL (via Prisma).
// O apps/app (painel CRM) e o apps/agent (webhook da Evolution) compartilham o
// mesmo banco (packages/db). A InMemoryMessageRepository serve para testes e
// demos sem banco.
// ============================================================================

export interface ConversationRecord {
  id: string;
  whatsappId: string;
  customerId: string;
  customerName: string | null;
  funnelStatus: string;
  department: string | null;
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  /** Orcamento/pedido vinculado (Monte seu PC), quando houver. */
  quote?: QuoteSummary | null;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  active: boolean;
}

export interface MessageRecord {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string | null;
  agentId: string | null;
  createdAt: string;
}

export interface MessageInput {
  type: string;
  text?: string | null;
  caption?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  whatsappId?: string | null;
  agentId?: string | null;
  status?: string;
}

export interface QuoteItemRecord {
  sku: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface QuoteRecord {
  id: string;
  code: string;
  totalCents: number;
  pixTotalCents: number;
  customer: { name: string | null; phone: string | null };
  items: QuoteItemRecord[];
}

/** Resumo do orcamento exposto ao painel de CRM (modulo Pedidos). */
export interface QuoteSummary {
  code: string;
  totalCents: number;
  pixTotalCents: number;
  installments: number;
  monthlyValueCents: number;
  parceledTotalCents: number;
  blingOrderId: string | null;
  blingNumber: string | null;
  blingStatus: string | null;
  items: QuoteItemRecord[];
}

export interface IMessageRepository {
  ensureConversation(whatsappId: string, name?: string | null): Promise<ConversationRecord>;
  getConversationById(id: string): Promise<ConversationRecord | null>;
  getConversationByWhatsapp(whatsappId: string): Promise<ConversationRecord | null>;
  listConversations(): Promise<ConversationRecord[]>;
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  listAgents(): Promise<AgentRecord[]>;
  saveInboundMessage(conversationId: string, input: MessageInput): Promise<void>;
  saveOutboundMessage(conversationId: string, input: MessageInput): Promise<void>;
  touchConversation(conversationId: string, opts: { at?: string; unreadDelta?: number }): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  assume(conversationId: string, agentId: string): Promise<void>;
  release(conversationId: string): Promise<void>;
  setFunnelStatus(conversationId: string, status: string): Promise<ConversationRecord>;
  /** Atribui departamento (fila) e, opcionalmente, um atendente responsavel. */
  setDepartment(
    conversationId: string,
    opts: { department?: string | null; assignedAgentId?: string | null },
  ): Promise<ConversationRecord>;
  findQuoteByCode(code: string): Promise<QuoteRecord | null>;
  /** Marca a conversa como oportunidade de alto valor e vincula o orcamento. */
  markHighValueOpportunity(
    conversationId: string,
    quoteCode: string,
  ): Promise<{ flagged: boolean; linked: boolean }>;
  getQuoteForConversation(conversationId: string): Promise<QuoteRecord | null>;
  setQuoteBling(quoteId: string, blingOrderId: string, blingNumber: string): Promise<void>;
}

// ----------------------------------------------------------------------------
// Implementacao com Prisma (PostgreSQL)
// ----------------------------------------------------------------------------
export class PrismaMessageRepository implements IMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureConversation(whatsappId: string, name?: string | null): Promise<ConversationRecord> {
    const clean = normalizePhone(whatsappId);
    const customer = await this.prisma.customer.upsert({
      where: { whatsappId: clean },
      update: name ? { name } : {},
      create: { whatsappId: clean, name: name ?? null },
    });
    const conversation = await this.prisma.conversation.upsert({
      where: { customerId: customer.id },
      update: {},
      create: { customerId: customer.id },
    });
    return toConversationRecord(conversation, customer.name, customer.whatsappId);
  }

  async getConversationById(id: string): Promise<ConversationRecord | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: { customer: true, quote: { include: { items: true } } },
    });
    return conv
      ? toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote))
      : null;
  }

  async getConversationByWhatsapp(whatsappId: string): Promise<ConversationRecord | null> {
    const conv = await this.prisma.conversation.findFirst({
      where: { customer: { whatsappId: normalizePhone(whatsappId) } },
      include: { customer: true, quote: { include: { items: true } } },
    });
    return conv
      ? toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote))
      : null;
  }

  async listConversations(): Promise<ConversationRecord[]> {
    const convs = await this.prisma.conversation.findMany({
      include: { customer: true, quote: { include: { items: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return convs.map((c) =>
      toConversationRecord(c, c.customer.name, c.customer.whatsappId, mapQuoteSummary(c.quote)),
    );
  }

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return messages.map((m) => ({
      id: m.id,
      direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
      type: m.type,
      text: m.text,
      agentId: m.agentId,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async listAgents(): Promise<AgentRecord[]> {
    const agents = await this.prisma.agent.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      email: a.email,
      active: a.active,
    }));
  }

  async saveInboundMessage(conversationId: string, input: MessageInput): Promise<void> {
    await this.prisma.message.create({
      data: {
        conversationId,
        direction: 'inbound',
        type: input.type,
        text: input.text ?? null,
        caption: input.caption ?? null,
        mediaUrl: input.mediaUrl ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        whatsappId: input.whatsappId ?? null,
        status: 'received',
      },
    });
  }

  async saveOutboundMessage(conversationId: string, input: MessageInput): Promise<void> {
    await this.prisma.message.create({
      data: {
        conversationId,
        direction: 'outbound',
        type: input.type,
        text: input.text ?? null,
        caption: input.caption ?? null,
        mediaUrl: input.mediaUrl ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        agentId: input.agentId ?? null,
        whatsappId: input.whatsappId ?? null,
        status: input.status ?? 'sent',
      },
    });
  }

  async touchConversation(
    conversationId: string,
    opts: { at?: string; unreadDelta?: number },
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(opts.at ? { lastMessageAt: new Date(opts.at) } : {}),
        ...(opts.unreadDelta !== undefined
          ? { unreadCount: { increment: opts.unreadDelta } }
          : {}),
      },
    });
  }

  async markRead(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
  }

  async assume(conversationId: string, agentId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanMode: true, assignedAgentId: agentId, unreadCount: 0 },
    });
  }

  async release(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanMode: false, assignedAgentId: null },
    });
  }

  async setFunnelStatus(conversationId: string, status: string): Promise<ConversationRecord> {
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { funnelStatus: status as FunnelStatus },
      include: { customer: true, quote: { include: { items: true } } },
    });
    return toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote));
  }

  async setDepartment(
    conversationId: string,
    opts: { department?: string | null; assignedAgentId?: string | null },
  ): Promise<ConversationRecord> {
    const data: Record<string, unknown> = {};
    if (opts.department !== undefined) {
      data['department'] = opts.department === null ? null : (opts.department as Department);
    }
    if (opts.assignedAgentId !== undefined) {
      data['assignedAgentId'] = opts.assignedAgentId;
    }
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data,
      include: { customer: true, quote: { include: { items: true } } },
    });
    return toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote));
  }

  async findQuoteByCode(code: string): Promise<QuoteRecord | null> {
    const quote = await this.prisma.quote.findUnique({
      where: { code },
      include: { customer: true, items: true },
    });
    if (!quote) return null;
    return {
      id: quote.id,
      code: quote.code,
      totalCents: quote.totalCents,
      pixTotalCents: quote.pixTotalCents,
      customer: { name: quote.customer.name, phone: quote.customer.whatsappId },
      items: quote.items.map((item) => ({
        sku: item.sku,
        name: item.name,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      })),
    };
  }

  async markHighValueOpportunity(
    conversationId: string,
    quoteCode: string,
  ): Promise<{ flagged: boolean; linked: boolean }> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });
    if (!conv) return { flagged: false, linked: false };

    const quote = await this.prisma.quote.findUnique({ where: { code: quoteCode } });
    let linked = false;
    if (quote && quote.customerId === conv.customerId) {
      try {
        await this.prisma.quote.update({
          where: { id: quote.id },
          data: { conversationId },
        });
        linked = true;
      } catch {
        linked = false;
      }
    }

    if (EARLY_FUNNEL_STATUSES.has(conv.funnelStatus)) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { funnelStatus: 'ALTA_VALOR', unreadCount: { increment: 1 } },
      });
    }
    return { flagged: true, linked };
  }

  async getQuoteForConversation(conversationId: string): Promise<QuoteRecord | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        quote: { include: { items: true, customer: true } },
      },
    });
    const quote = conv?.quote;
    if (!quote) return null;
    return {
      id: quote.id,
      code: quote.code,
      totalCents: quote.totalCents,
      pixTotalCents: quote.pixTotalCents,
      customer: { name: quote.customer.name, phone: quote.customer.whatsappId },
      items: quote.items.map((item) => ({
        sku: item.sku,
        name: item.name,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      })),
    };
  }

  async setQuoteBling(quoteId: string, blingOrderId: string, blingNumber: string): Promise<void> {
    await this.prisma.quote.update({
      where: { id: quoteId },
      data: { blingOrderId, blingNumber, blingStatus: 'created' },
    });
  }
}

// ----------------------------------------------------------------------------
// Implementacao em memoria (testes / demo sem PostgreSQL)
// ----------------------------------------------------------------------------
export class InMemoryMessageRepository implements IMessageRepository {
  private conversations = new Map<string, ConversationRecord>();
  private whatsappIndex = new Map<string, string>();
  private messages: Array<{
    conversationId: string;
    input: MessageInput;
    direction: string;
    at: string;
  }> = [];
  /** Orcamentos vinculados a uma conversa (chave = conversationId). */
  private quotes = new Map<string, QuoteRecord>();
  /** Indice de orcamentos por codigo (inclusive os ainda nao vinculados). */
  private quoteIndex = new Map<string, QuoteRecord>();
  /** Resumo do orcamento exposto ao painel/automacao (chave = conversationId). */
  private quoteSummaries = new Map<string, QuoteSummary>();

  async ensureConversation(whatsappId: string, name?: string | null): Promise<ConversationRecord> {
    const clean = normalizePhone(whatsappId);
    const existingId = this.whatsappIndex.get(clean);
    if (existingId) {
      const conv = this.conversations.get(existingId);
      if (conv) {
        if (name) conv.customerName = name;
        return conv;
      }
    }
    const conv: ConversationRecord = {
      id: `conv-${this.conversations.size + 1}`,
      whatsappId: clean,
      customerId: `cust-${clean}`,
      customerName: name ?? null,
      funnelStatus: 'NOVO',
      department: null,
      humanMode: false,
      assignedAgentId: null,
      unreadCount: 0,
      lastMessageAt: null,
    };
    this.conversations.set(conv.id, conv);
    this.whatsappIndex.set(clean, conv.id);
    return conv;
  }

  async getConversationById(id: string): Promise<ConversationRecord | null> {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    return { ...conv, quote: this.quoteSummaries.get(id) ?? null };
  }

  async getConversationByWhatsapp(whatsappId: string): Promise<ConversationRecord | null> {
    const id = this.whatsappIndex.get(normalizePhone(whatsappId));
    if (!id) return null;
    const conv = this.conversations.get(id);
    if (!conv) return null;
    return { ...conv, quote: this.quoteSummaries.get(id) ?? null };
  }

  async listConversations(): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
      .map((conv) => ({ ...conv, quote: this.quoteSummaries.get(conv.id) ?? null }));
  }

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId)
      .map((m, i) => ({
        id: `msg-${i}`,
        direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
        type: m.input.type,
        text: m.input.text ?? null,
        agentId: m.input.agentId ?? null,
        createdAt: m.at,
      }));
  }

  async listAgents(): Promise<AgentRecord[]> {
    return DEMO_AGENTS.map((a) => ({ ...a }));
  }

  async saveInboundMessage(conversationId: string, input: MessageInput): Promise<void> {
    this.messages.push({ conversationId, input, direction: 'inbound', at: new Date().toISOString() });
  }

  async saveOutboundMessage(conversationId: string, input: MessageInput): Promise<void> {
    this.messages.push({ conversationId, input, direction: 'outbound', at: new Date().toISOString() });
  }

  async touchConversation(
    conversationId: string,
    opts: { at?: string; unreadDelta?: number },
  ): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    if (opts.at) conv.lastMessageAt = opts.at;
    if (opts.unreadDelta !== undefined) conv.unreadCount += opts.unreadDelta;
  }

  async markRead(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) conv.unreadCount = 0;
  }

  async assume(conversationId: string, agentId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.humanMode = true;
      conv.assignedAgentId = agentId;
      conv.unreadCount = 0;
    }
  }

  async release(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.humanMode = false;
      conv.assignedAgentId = null;
    }
  }

  async setFunnelStatus(conversationId: string, status: string): Promise<ConversationRecord> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`Conversa nao encontrada: ${conversationId}`);
    conv.funnelStatus = status;
    return conv;
  }

  async setDepartment(
    conversationId: string,
    opts: { department?: string | null; assignedAgentId?: string | null },
  ): Promise<ConversationRecord> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`Conversa nao encontrada: ${conversationId}`);
    if (opts.department !== undefined) conv.department = opts.department;
    if (opts.assignedAgentId !== undefined) conv.assignedAgentId = opts.assignedAgentId;
    return conv;
  }

  async findQuoteByCode(code: string): Promise<QuoteRecord | null> {
    return this.quoteIndex.get(code) ?? null;
  }

  async markHighValueOpportunity(
    conversationId: string,
    quoteCode: string,
  ): Promise<{ flagged: boolean; linked: boolean }> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return { flagged: false, linked: false };

    const quote = await this.findQuoteByCode(quoteCode);
    let linked = false;
    if (quote && this.quotes.get(conversationId)?.id !== quote.id) {
      this.quotes.set(conversationId, quote);
      linked = true;
    }

    if (EARLY_FUNNEL_STATUSES.has(conv.funnelStatus)) {
      conv.funnelStatus = 'ALTA_VALOR';
      conv.unreadCount += 1;
    }
    return { flagged: true, linked };
  }

  /** Apenas para testes/demos: registra um orcamento no repositorio em memoria. */
  seedQuote(
    quote: QuoteRecord,
    conversationId?: string,
    summary?: Partial<
      Pick<QuoteSummary, 'installments' | 'monthlyValueCents' | 'parceledTotalCents' | 'blingOrderId' | 'blingNumber' | 'blingStatus'>
    >,
  ): void {
    this.quoteIndex.set(quote.code, quote);
    if (conversationId) {
      this.quotes.set(conversationId, quote);
      this.quoteSummaries.set(conversationId, {
        code: quote.code,
        totalCents: quote.totalCents,
        pixTotalCents: quote.pixTotalCents,
        installments: summary?.installments ?? 1,
        monthlyValueCents: summary?.monthlyValueCents ?? quote.totalCents,
        parceledTotalCents: summary?.parceledTotalCents ?? quote.totalCents,
        blingOrderId: summary?.blingOrderId ?? null,
        blingNumber: summary?.blingNumber ?? null,
        blingStatus: summary?.blingStatus ?? null,
        items: quote.items.map((item) => ({
          sku: item.sku,
          name: item.name,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
        })),
      });
    }
  }

  async getQuoteForConversation(conversationId: string): Promise<QuoteRecord | null> {
    return this.quotes.get(conversationId) ?? null;
  }

  async setQuoteBling(quoteId: string, blingOrderId: string, blingNumber: string): Promise<void> {
    for (const quote of this.quotes.values()) {
      if (quote.id === quoteId) {
        // sem persistencia extra em memoria
        void quote;
      }
    }
    void blingOrderId;
    void blingNumber;
  }
}

function toConversationRecord(
  conv: {
    id: string;
    customerId: string;
    funnelStatus: FunnelStatus;
    department: Department | null;
    humanMode: boolean;
    assignedAgentId: string | null;
    unreadCount: number;
    lastMessageAt: Date | null;
    quote?: { id: string; items: { sku: string | null; name: string; unitPriceCents: number; quantity: number }[] } | null;
  },
  customerName: string | null,
  customerWhatsappId: string,
  quoteSummary?: QuoteSummary | null,
): ConversationRecord {
  return {
    id: conv.id,
    whatsappId: customerWhatsappId,
    customerId: conv.customerId,
    customerName,
    funnelStatus: conv.funnelStatus,
    department: conv.department,
    humanMode: conv.humanMode,
    assignedAgentId: conv.assignedAgentId,
    unreadCount: conv.unreadCount,
    lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
    quote: quoteSummary ?? null,
  };
}

function mapQuoteSummary(quote: {
  code: string;
  totalCents: number;
  pixTotalCents: number;
  installments: number;
  installmentValueCents: number;
  parceledTotalCents: number;
  blingOrderId: string | null;
  blingNumber: string | null;
  blingStatus: string | null;
  items: { sku: string | null; name: string; unitPriceCents: number; quantity: number }[];
} | null): QuoteSummary | null {
  if (!quote) return null;
  return {
    code: quote.code,
    totalCents: quote.totalCents,
    pixTotalCents: quote.pixTotalCents,
    installments: quote.installments,
    monthlyValueCents: quote.installmentValueCents,
    parceledTotalCents: quote.parceledTotalCents,
    blingOrderId: quote.blingOrderId,
    blingNumber: quote.blingNumber,
    blingStatus: quote.blingStatus,
    items: quote.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
    })),
  };
}

/** Estados iniciais do funil que podem ser promovidos a ALTA_VALOR. */
const EARLY_FUNNEL_STATUSES = new Set<string>([
  'NOVO',
  'MONTANDO_PC',
  'EM_QUALIFICACAO',
]);

/** Atendentes demo para o repo em memoria (espelha o seed do packages/db). */
const DEMO_AGENTS: AgentRecord[] = [
  { id: 'agent-ana', name: 'Ana Vendedora', role: 'Vendedora', email: 'ana@loja.com', active: true },
  { id: 'agent-bruno', name: 'Bruno Tech', role: 'Montagem/Orçamentos', email: 'bruno@loja.com', active: true },
  { id: 'agent-carla', name: 'Carla Admin', role: 'Financeiro/NF', email: 'carla@loja.com', active: true },
];

function normalizePhone(phone: string): string {
  return phone.replace(/@s\.whatsapp\.net$/i, '').replace(/[^\d]/g, '');
}
