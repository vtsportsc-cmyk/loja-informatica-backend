import {
  Department,
  FunnelStatus,
  LeadSource,
  LostReason,
  isLeadSource,
  isLostReason,
  FUNNEL_STATUS_LABELS,
  LOST_REASON_LABELS,
} from '@loja/db';
import type { PrismaClient, ConversationEventType } from '@loja/db';

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
  leadSource: string | null;
  /** Atribuicao de trafego (UTMs) capturada no "Monte seu PC" / Instagram. */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  lostReason: string | null;
  lostAt: string | null;
  lastFollowUpAt: string | null;
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  /** Orcamento/pedido vinculado (Monte seu PC), quando houver. */
  quote?: QuoteSummary | null;
}

export interface TimelineEventRecord {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface ConversationNoteRecord {
  id: string;
  agentId: string | null;
  text: string;
  createdAt: string;
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
  /** Tokens consumidos pela IA para gerar esta mensagem (outbound). */
  tokensUsed: number;
  /** Tempo total (ms) de geracao da resposta pela IA (outbound). */
  responseTimeMs: number;
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
  /** Metrica: tokens consumidos pela IA (respostas outbound). */
  tokensUsed?: number;
  /** Metrica: tempo de geracao da resposta pela IA em ms (respostas outbound). */
  responseTimeMs?: number;
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
  /** Atribuicao de trafego (UTMs) capturada no "Monte seu PC". */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

/** Resumo do orcamento exposto ao painel de CRM (modulo Pedidos). */
export interface QuoteSummary {
  code: string;
  totalCents: number;
  pixTotalCents: number;
  installments: number;
  monthlyValueCents: number;
  parceledTotalCents: number;
  /** Atribuicao de trafego (UTMs) capturada no "Monte seu PC". */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  blingOrderId: string | null;
  blingNumber: string | null;
  blingStatus: string | null;
  items: QuoteItemRecord[];
}

export interface IMessageRepository {
  /** Ping de saude do banco (SELECT 1 no PostgreSQL; true no modo memoria). */
  ping(): Promise<boolean>;
  /** Garante uma conversa para o contato. `channel` define a origem do lead (whatsapp/instagram). */
  ensureConversation(
    whatsappId: string,
    name?: string | null,
    opts?: { channel?: 'whatsapp' | 'instagram' },
  ): Promise<ConversationRecord>;
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
  /** Define a origem do lead (BUILDER/WHATSAPP_DIRECT/INDICACAO/BALCAO). */
  setLeadSource(conversationId: string, source: string | null): Promise<ConversationRecord>;
  /** Marca a conversa como perdida (CANCELADO) com o motivo informado. */
  markLost(conversationId: string, lostReason: string): Promise<ConversationRecord>;
  /** Historico cronologico de atividades da conversa (timeline unificado). */
  listTimeline(conversationId: string): Promise<TimelineEventRecord[]>;
  /** Registra uma anotacao interna do atendente na conversa. */
  addNote(conversationId: string, input: { agentId?: string | null; text: string }): Promise<ConversationNoteRecord>;
  /** Lista as anotações internas da conversa (mais recentes primeiro). */
  listNotes(conversationId: string): Promise<ConversationNoteRecord[]>;
  /** Conversas ALTA_VALOR com orcamento e sem interacao desde `since` (e sem follow-up recente). */
  listPendingFollowUp(since: Date): Promise<ConversationRecord[]>;
  /** Registra o follow-up de reengajamento e evita novo envio imediato. */
  markFollowedUp(conversationId: string): Promise<void>;
}

// ----------------------------------------------------------------------------
// Implementacao com Prisma (PostgreSQL)
// ----------------------------------------------------------------------------
export class PrismaMessageRepository implements IMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ping(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async ensureConversation(
    whatsappId: string,
    name?: string | null,
    opts?: { channel?: 'whatsapp' | 'instagram' },
  ): Promise<ConversationRecord> {
    const clean = normalizePhone(whatsappId);
    const customer = await this.prisma.customer.upsert({
      where: { whatsappId: clean },
      update: name ? { name } : {},
      create: { whatsappId: clean, name: name ?? null },
    });
    let conversation = await this.prisma.conversation.findUnique({
      where: { customerId: customer.id },
      include: { customer: true, quote: { include: { items: true } } },
    });
    if (!conversation) {
      const channel = opts?.channel ?? 'whatsapp';
      conversation = await this.prisma.conversation.create({
        data: {
          customerId: customer.id,
          leadSource: channel === 'instagram' ? 'INSTAGRAM' : 'WHATSAPP_DIRECT',
        },
        include: { customer: true, quote: { include: { items: true } } },
      });
      await this.addEvent(
        conversation.id,
        'CONVERSATION_CREATED',
        channel === 'instagram' ? 'Conversa iniciada (Instagram)' : 'Conversa iniciada',
        channel === 'instagram'
          ? 'Cliente comentou no Instagram e recebeu o link do Monte seu PC'
          : 'Cliente entrou em contato pelo WhatsApp',
      );
    }
    return toConversationRecord(conversation, customer.name, customer.whatsappId, mapQuoteSummary(conversation.quote));
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
      tokensUsed: m.tokensUsed,
      responseTimeMs: m.responseTimeMs,
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
        tokensUsed: 0,
        responseTimeMs: 0,
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
        tokensUsed: input.tokensUsed ?? 0,
        responseTimeMs: input.responseTimeMs ?? 0,
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
    const prev = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanMode: true, assignedAgentId: agentId, unreadCount: 0 },
    });
    await this.addEvent(
      conversationId,
      'HANDOFF',
      'Atendimento humano iniciado',
      `Atendente ${agentId} assumiu a conversa`,
    );
    void prev;
  }

  async release(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanMode: false, assignedAgentId: null },
    });
    await this.addEvent(
      conversationId,
      'HANDOFF',
      'Atendimento liberado para a IA',
      'O assistente virtual voltou a responder',
    );
  }

  async setFunnelStatus(conversationId: string, status: string): Promise<ConversationRecord> {
    const prev = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true, quote: { include: { items: true } } },
    });
    if (!prev) throw new Error(`Conversa nao encontrada: ${conversationId}`);

    const wasLost = prev.funnelStatus === 'CANCELADO';
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        funnelStatus: status as FunnelStatus,
        ...(wasLost && status !== 'CANCELADO'
          ? { lostReason: null, lostAt: null }
          : {}),
      },
      include: { customer: true, quote: { include: { items: true } } },
    });

    if (prev.funnelStatus !== (status as FunnelStatus)) {
      await this.addEvent(
        conversationId,
        'FUNNEL_STATUS_CHANGED',
        `Funil: ${FUNNEL_STATUS_LABELS[prev.funnelStatus]} → ${FUNNEL_STATUS_LABELS[status as FunnelStatus]}`,
        `Status atualizado para ${FUNNEL_STATUS_LABELS[status as FunnelStatus]}`,
      );
    }

    return toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote));
  }

  async setLeadSource(
    conversationId: string,
    source: string | null,
  ): Promise<ConversationRecord> {
    if (source !== null && !isLeadSource(source)) {
      throw new Error(`origem do lead invalida: ${source}`);
    }
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        leadSource: source === null ? null : (source as LeadSource),
      },
      include: { customer: true, quote: { include: { items: true } } },
    });
    return toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote));
  }

  async markLost(conversationId: string, lostReason: string): Promise<ConversationRecord> {
    if (!isLostReason(lostReason)) {
      throw new Error(`motivo de perda invalido: ${lostReason}`);
    }
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        funnelStatus: 'CANCELADO',
        lostReason: lostReason as LostReason,
        lostAt: new Date(),
      },
      include: { customer: true, quote: { include: { items: true } } },
    });
    await this.addEvent(
      conversationId,
      'LEAD_LOST',
      'Pedido perdido',
      `Motivo: ${LOST_REASON_LABELS[lostReason as LostReason]}`,
    );
    return toConversationRecord(conv, conv.customer.name, conv.customer.whatsappId, mapQuoteSummary(conv.quote));
  }

  async listTimeline(conversationId: string): Promise<TimelineEventRecord[]> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async listPendingFollowUp(since: Date): Promise<ConversationRecord[]> {
    const convs = await this.prisma.conversation.findMany({
      where: {
        funnelStatus: 'ALTA_VALOR',
        quote: { isNot: null },
        lastMessageAt: { lt: since },
        OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: since } }],
      },
      include: { customer: true, quote: { include: { items: true } } },
      take: 50,
    });
    return convs.map((c) =>
      toConversationRecord(c, c.customer.name, c.customer.whatsappId, mapQuoteSummary(c.quote)),
    );
  }

  async markFollowedUp(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastFollowUpAt: new Date() },
    });
    await this.addEvent(
      conversationId,
      'FOLLOW_UP_SENT',
      'Follow-up enviado',
      'Lembrete de orçamento enviado pelo WhatsApp',
    );
  }

  async addNote(
    conversationId: string,
    input: { agentId?: string | null; text: string },
  ): Promise<ConversationNoteRecord> {
    const text = input.text.trim();
    if (!text) throw new Error('anotacao nao pode ser vazia');
    const note = await this.prisma.conversationNote.create({
      data: { conversationId, agentId: input.agentId ?? null, text },
    });
    await this.addEvent(
      conversationId,
      'NOTE_ADDED',
      'Anotação interna',
      input.agentId ? `Nota de ${input.agentId}: ${truncate(text, 120)}` : truncate(text, 120),
    );
    return { id: note.id, agentId: note.agentId, text: note.text, createdAt: note.createdAt.toISOString() };
  }

  async listNotes(conversationId: string): Promise<ConversationNoteRecord[]> {
    const notes = await this.prisma.conversationNote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return notes.map((n) => ({
      id: n.id,
      agentId: n.agentId,
      text: n.text,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  private async addEvent(
    conversationId: string,
    type: string,
    title: string,
    detail?: string,
  ): Promise<void> {
    try {
      await this.prisma.conversationEvent.create({
        data: { conversationId, type: type as ConversationEventType, title, detail },
      });
    } catch {
      // evento e auxiliar; nunca bloqueia o fluxo principal
    }
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
      utmSource: quote.utmSource,
      utmMedium: quote.utmMedium,
      utmCampaign: quote.utmCampaign,
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

    if (linked) {
      await this.addEvent(
        conversationId,
        'QUOTE_CREATED',
        `Orçamento ${quoteCode} vinculado`,
        'Orçamento do Monte seu PC vinculado à conversa',
      );
    }

    if (EARLY_FUNNEL_STATUSES.has(conv.funnelStatus)) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { funnelStatus: 'ALTA_VALOR', unreadCount: { increment: 1 } },
      });
      await this.addEvent(
        conversationId,
        'FUNNEL_STATUS_CHANGED',
        `Funil: ${FUNNEL_STATUS_LABELS[conv.funnelStatus]} → Oportunidade de Alto Valor`,
        'Orçamento de alto valor detectado no WhatsApp',
      );
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
      utmSource: quote.utmSource,
      utmMedium: quote.utmMedium,
      utmCampaign: quote.utmCampaign,
      items: quote.items.map((item) => ({
        sku: item.sku,
        name: item.name,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      })),
    };
  }

  async setQuoteBling(quoteId: string, blingOrderId: string, blingNumber: string): Promise<void> {
    const quote = await this.prisma.quote.update({
      where: { id: quoteId },
      data: { blingOrderId, blingNumber, blingStatus: 'created' },
      include: { conversation: true },
    });
    if (quote.conversationId) {
      await this.addEvent(
        quote.conversationId,
        'ORDER_EMITTED',
        `Pedido ${quote.code} emitido`,
        `Pedido enviado ao Bling (#${blingNumber}) para emissão de NF/expedição`,
      );
    }
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

  async ping(): Promise<boolean> {
    return true;
  }
  /** Orcamentos vinculados a uma conversa (chave = conversationId). */
  private quotes = new Map<string, QuoteRecord>();
  /** Indice de orcamentos por codigo (inclusive os ainda nao vinculados). */
  private quoteIndex = new Map<string, QuoteRecord>();
  /** Resumo do orcamento exposto ao painel/automacao (chave = conversationId). */
  private quoteSummaries = new Map<string, QuoteSummary>();
  /** Timeline unificado de atividades da conversa. */
  private timeline: Array<{
    conversationId: string;
    id: string;
    type: string;
    title: string;
    detail: string | null;
    at: string;
  }> = [];
  private timelineCounter = 0;
  /** Anotações internas dos atendentes. */
  private notes: Array<{ conversationId: string } & ConversationNoteRecord> = [];
  private noteCounter = 0;

  private addEvent(
    conversationId: string,
    type: string,
    title: string,
    detail?: string,
  ): void {
    this.timelineCounter += 1;
    this.timeline.push({
      conversationId,
      id: `evt-${this.timelineCounter}`,
      type,
      title,
      detail: detail ?? null,
      at: new Date().toISOString(),
    });
  }

  async ensureConversation(
    whatsappId: string,
    name?: string | null,
    opts?: { channel?: 'whatsapp' | 'instagram' },
  ): Promise<ConversationRecord> {
    const clean = normalizePhone(whatsappId);
    const existingId = this.whatsappIndex.get(clean);
    if (existingId) {
      const conv = this.conversations.get(existingId);
      if (conv) {
        if (name) conv.customerName = name;
        return conv;
      }
    }
    const channel = opts?.channel ?? 'whatsapp';
    const conv: ConversationRecord = {
      id: `conv-${this.conversations.size + 1}`,
      whatsappId: clean,
      customerId: `cust-${clean}`,
      customerName: name ?? null,
      funnelStatus: 'NOVO',
      department: null,
      leadSource: channel === 'instagram' ? 'INSTAGRAM' : 'WHATSAPP_DIRECT',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      lostReason: null,
      lostAt: null,
      lastFollowUpAt: null,
      humanMode: false,
      assignedAgentId: null,
      unreadCount: 0,
      lastMessageAt: null,
    };
    this.conversations.set(conv.id, conv);
    this.whatsappIndex.set(clean, conv.id);
    this.addEvent(
      conv.id,
      'CONVERSATION_CREATED',
      channel === 'instagram' ? 'Conversa iniciada (Instagram)' : 'Conversa iniciada',
      channel === 'instagram'
        ? 'Cliente comentou no Instagram e recebeu o link do Monte seu PC'
        : 'Cliente entrou em contato pelo WhatsApp',
    );
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
        tokensUsed: m.input.tokensUsed ?? 0,
        responseTimeMs: m.input.responseTimeMs ?? 0,
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
      this.addEvent(
        conversationId,
        'HANDOFF',
        'Atendimento humano iniciado',
        `Atendente ${agentId} assumiu a conversa`,
      );
    }
  }

  async release(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.humanMode = false;
      conv.assignedAgentId = null;
      this.addEvent(
        conversationId,
        'HANDOFF',
        'Atendimento liberado para a IA',
        'O assistente virtual voltou a responder',
      );
    }
  }

  async setFunnelStatus(conversationId: string, status: string): Promise<ConversationRecord> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`Conversa nao encontrada: ${conversationId}`);
    const previous = conv.funnelStatus;
    conv.funnelStatus = status;
    if (previous === 'CANCELADO' && status !== 'CANCELADO') {
      conv.lostReason = null;
      conv.lostAt = null;
    }
    if (previous !== status) {
      this.addEvent(
        conversationId,
        'FUNNEL_STATUS_CHANGED',
        `Funil: ${FUNNEL_STATUS_LABELS[previous as FunnelStatus] ?? previous} → ${FUNNEL_STATUS_LABELS[status as FunnelStatus] ?? status}`,
        `Status atualizado para ${FUNNEL_STATUS_LABELS[status as FunnelStatus] ?? status}`,
      );
    }
    return conv;
  }

  async setLeadSource(
    conversationId: string,
    source: string | null,
  ): Promise<ConversationRecord> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`Conversa nao encontrada: ${conversationId}`);
    if (source !== null && !isLeadSource(source)) {
      throw new Error(`origem do lead invalida: ${source}`);
    }
    conv.leadSource = source;
    return conv;
  }

  async markLost(conversationId: string, lostReason: string): Promise<ConversationRecord> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`Conversa nao encontrada: ${conversationId}`);
    if (!isLostReason(lostReason)) {
      throw new Error(`motivo de perda invalido: ${lostReason}`);
    }
    conv.funnelStatus = 'CANCELADO';
    conv.lostReason = lostReason;
    conv.lostAt = new Date().toISOString();
    this.addEvent(
      conversationId,
      'LEAD_LOST',
      'Pedido perdido',
      `Motivo: ${LOST_REASON_LABELS[lostReason as LostReason]}`,
    );
    return conv;
  }

  async listTimeline(conversationId: string): Promise<TimelineEventRecord[]> {
    return this.timeline
      .filter((e) => e.conversationId === conversationId)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((e) => ({ id: e.id, type: e.type, title: e.title, detail: e.detail, createdAt: e.at }));
  }

  async listPendingFollowUp(since: Date): Promise<ConversationRecord[]> {
    const sinceMs = since.getTime();
    const results: ConversationRecord[] = [];
    for (const conv of this.conversations.values()) {
      if (conv.funnelStatus !== 'ALTA_VALOR') continue;
      if (!this.quoteSummaries.has(conv.id)) continue;
      const lastAt = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;
      if (lastAt >= sinceMs) continue;
      const followUpAt = conv.lastFollowUpAt ? new Date(conv.lastFollowUpAt).getTime() : 0;
      if (followUpAt >= sinceMs) continue;
      results.push({ ...conv, quote: this.quoteSummaries.get(conv.id) ?? null });
    }
    return results;
  }

  async markFollowedUp(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    conv.lastFollowUpAt = new Date().toISOString();
    this.addEvent(
      conversationId,
      'FOLLOW_UP_SENT',
      'Follow-up enviado',
      'Lembrete de orçamento enviado pelo WhatsApp',
    );
  }

  async addNote(
    conversationId: string,
    input: { agentId?: string | null; text: string },
  ): Promise<ConversationNoteRecord> {
    const text = input.text.trim();
    if (!text) throw new Error('anotacao nao pode ser vazia');
    this.noteCounter += 1;
    const note: ConversationNoteRecord = {
      id: `note-${this.noteCounter}`,
      agentId: input.agentId ?? null,
      text,
      createdAt: new Date().toISOString(),
    };
    this.notes.push({ conversationId, ...note });
    this.addEvent(
      conversationId,
      'NOTE_ADDED',
      'Anotação interna',
      input.agentId ? `Nota de ${input.agentId}: ${truncate(text, 120)}` : truncate(text, 120),
    );
    return note;
  }

  async listNotes(conversationId: string): Promise<ConversationNoteRecord[]> {
    return this.notes
      .filter((n) => n.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(({ conversationId: _c, ...note }) => ({ ...note }));
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
      this.addEvent(
        conversationId,
        'QUOTE_CREATED',
        `Orçamento ${quoteCode} vinculado`,
        'Orçamento do Monte seu PC vinculado à conversa',
      );
    }

    if (EARLY_FUNNEL_STATUSES.has(conv.funnelStatus)) {
      const previous = conv.funnelStatus;
      conv.funnelStatus = 'ALTA_VALOR';
      conv.unreadCount += 1;
      this.addEvent(
        conversationId,
        'FUNNEL_STATUS_CHANGED',
        `Funil: ${FUNNEL_STATUS_LABELS[previous as FunnelStatus] ?? previous} → Oportunidade de Alto Valor`,
        'Orçamento de alto valor detectado no WhatsApp',
      );
    }
    return { flagged: true, linked };
  }

  /** Apenas para testes/demos: registra um orcamento no repositorio em memoria. */
  seedQuote(
    quote: QuoteRecord,
    conversationId?: string,
    summary?: Partial<
      Pick<QuoteSummary, 'installments' | 'monthlyValueCents' | 'parceledTotalCents' | 'blingOrderId' | 'blingNumber' | 'blingStatus' | 'utmSource' | 'utmMedium' | 'utmCampaign'>
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
        utmSource: summary?.utmSource ?? quote.utmSource,
        utmMedium: summary?.utmMedium ?? quote.utmMedium,
        utmCampaign: summary?.utmCampaign ?? quote.utmCampaign,
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
    for (const [conversationId, quote] of this.quotes.entries()) {
      if (quote.id === quoteId) {
        this.addEvent(
          conversationId,
          'ORDER_EMITTED',
          `Pedido ${quote.code} emitido`,
          `Pedido enviado ao Bling (#${blingNumber}) para emissão de NF/expedição`,
        );
      }
    }
    void blingOrderId;
  }
}

function toConversationRecord(
  conv: {
    id: string;
    customerId: string;
    funnelStatus: FunnelStatus;
    department: Department | null;
    leadSource: LeadSource | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    lostReason: LostReason | null;
    lostAt: Date | null;
    lastFollowUpAt: Date | null;
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
    leadSource: conv.leadSource,
    utmSource: conv.utmSource,
    utmMedium: conv.utmMedium,
    utmCampaign: conv.utmCampaign,
    lostReason: conv.lostReason,
    lostAt: conv.lostAt ? conv.lostAt.toISOString() : null,
    lastFollowUpAt: conv.lastFollowUpAt ? conv.lastFollowUpAt.toISOString() : null,
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
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
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
    utmSource: quote.utmSource,
    utmMedium: quote.utmMedium,
    utmCampaign: quote.utmCampaign,
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
