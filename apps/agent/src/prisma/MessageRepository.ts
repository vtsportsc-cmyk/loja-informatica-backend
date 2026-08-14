import { FunnelStatus } from '@loja/db';
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
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
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

export interface IMessageRepository {
  ensureConversation(whatsappId: string, name?: string | null): Promise<ConversationRecord>;
  getConversationById(id: string): Promise<ConversationRecord | null>;
  getConversationByWhatsapp(whatsappId: string): Promise<ConversationRecord | null>;
  listConversations(): Promise<ConversationRecord[]>;
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  saveInboundMessage(conversationId: string, input: MessageInput): Promise<void>;
  saveOutboundMessage(conversationId: string, input: MessageInput): Promise<void>;
  touchConversation(conversationId: string, opts: { at?: string; unreadDelta?: number }): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  assume(conversationId: string, agentId: string): Promise<void>;
  release(conversationId: string): Promise<void>;
  setFunnelStatus(conversationId: string, status: string): Promise<ConversationRecord>;
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
      include: { customer: true },
    });
    return conv ? toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId) : null;
  }

  async getConversationByWhatsapp(whatsappId: string): Promise<ConversationRecord | null> {
    const conv = await this.prisma.conversation.findFirst({
      where: { customer: { whatsappId: normalizePhone(whatsappId) } },
      include: { customer: true },
    });
    return conv ? toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId) : null;
  }

  async listConversations(): Promise<ConversationRecord[]> {
    const convs = await this.prisma.conversation.findMany({
      include: { customer: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return convs.map((c) => toConversationRecord(c, c.customer.name, c.customer.whatsappId));
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
      include: { customer: true },
    });
    return toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId);
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
  private quotes = new Map<string, QuoteRecord>();

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
    return this.conversations.get(id) ?? null;
  }

  async getConversationByWhatsapp(whatsappId: string): Promise<ConversationRecord | null> {
    const id = this.whatsappIndex.get(normalizePhone(whatsappId));
    return id ? (this.conversations.get(id) ?? null) : null;
  }

  async listConversations(): Promise<ConversationRecord[]> {
    return [...this.conversations.values()].sort((a, b) =>
      (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
    );
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
    humanMode: boolean;
    assignedAgentId: string | null;
    unreadCount: number;
    lastMessageAt: Date | null;
  },
  customerName: string | null,
  customerWhatsappId: string,
): ConversationRecord {
  return {
    id: conv.id,
    whatsappId: customerWhatsappId,
    customerId: conv.customerId,
    customerName,
    funnelStatus: conv.funnelStatus,
    humanMode: conv.humanMode,
    assignedAgentId: conv.assignedAgentId,
    unreadCount: conv.unreadCount,
    lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
  };
}

function normalizePhone(phone: string): string {
  return phone.replace(/@s\.whatsapp\.net$/i, '').replace(/[^\d]/g, '');
}
