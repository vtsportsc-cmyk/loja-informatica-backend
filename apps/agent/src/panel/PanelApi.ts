import { FUNNEL_STATUSES, isFunnelStatus } from '@loja/db';
import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import type { BlingOrderService } from '../integration/bling/BlingOrderService.js';
import type { IMessageRepository } from '../prisma/MessageRepository.js';

// ============================================================================
// API REST consumida pelo Painel de CRM (apps/app -> apps/agent).
// Aplicacoes:
//   POST /api/messages                      -> vendedor envia msg ao cliente
//   POST /api/conversations/:id/handoff     -> assumir / liberar atendimento
//   POST /api/conversations/:id/status      -> mover status do funil (e Bling)
// Todas exigem o header `x-agent-key` (AGENT_API_KEY).
// ============================================================================

export interface PanelApiDeps {
  repository: IMessageRepository;
  evolution: EvolutionApi;
  bling: BlingOrderService;
  apiKey: string;
  logger?: (message: string) => void;
}

export interface PanelApiResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export class PanelApi {
  private readonly repository: IMessageRepository;
  private readonly evolution: EvolutionApi;
  private readonly bling: BlingOrderService;
  private readonly apiKey: string;
  private readonly logger: (message: string) => void;

  constructor(deps: PanelApiDeps) {
    this.repository = deps.repository;
    this.evolution = deps.evolution;
    this.bling = deps.bling;
    this.apiKey = deps.apiKey;
    this.logger = deps.logger ?? ((m) => console.log(`[panel] ${m}`));
  }

  checkAuth(key: string | undefined): boolean {
    return Boolean(this.apiKey) && key === this.apiKey;
  }

  async listConversations(): Promise<PanelApiResult> {
    const conversations = await this.repository.listConversations();
    return { ok: true, status: 200, data: { conversations } };
  }

  async getConversation(conversationId: string): Promise<PanelApiResult> {
    const conversation = await this.repository.getConversationById(conversationId);
    if (!conversation) {
      return { ok: false, status: 404, error: 'conversa nao encontrada' };
    }
    const messages = await this.repository.listMessages(conversationId);
    return { ok: true, status: 200, data: { conversation, messages } };
  }

  async sendMessage(body: unknown): Promise<PanelApiResult> {
    const { conversationId, agentId, text } = body as {
      conversationId?: string;
      agentId?: string;
      text?: string;
    };
    if (!conversationId || !text?.trim()) {
      return { ok: false, status: 400, error: 'conversationId e text sao obrigatorios' };
    }

    const conversation = await this.repository.getConversationById(conversationId);
    if (!conversation) {
      return { ok: false, status: 404, error: 'conversa nao encontrada' };
    }

    await this.evolution.sendText(conversation.whatsappId, text);
    await this.repository.saveOutboundMessage(conversationId, {
      type: 'text',
      text,
      agentId: agentId ?? null,
      status: 'sent',
    });
    await this.repository.markRead(conversationId);
    await this.repository.touchConversation(conversationId, { at: new Date().toISOString() });

    return { ok: true, status: 200, data: { conversationId } };
  }

  async handoff(conversationId: string, body: unknown): Promise<PanelApiResult> {
    const { action, agentId } = body as { action?: string; agentId?: string };
    if (action === 'assume') {
      if (!agentId) return { ok: false, status: 400, error: 'agentId e obrigatorio para assumir' };
      await this.repository.assume(conversationId, agentId);
      this.logger(`[${conversationId}] atendimento assumido pelo agente ${agentId}; IA pausada.`);
      return { ok: true, status: 200, data: { humanMode: true } };
    }
    if (action === 'release') {
      await this.repository.release(conversationId);
      this.logger(`[${conversationId}] atendimento liberado de volta para a IA.`);
      return { ok: true, status: 200, data: { humanMode: false } };
    }
    return { ok: false, status: 400, error: 'action deve ser "assume" ou "release"' };
  }

  async setStatus(conversationId: string, body: unknown): Promise<PanelApiResult> {
    const { status } = body as { status?: string };
    if (!status || !isFunnelStatus(status)) {
      return { ok: false, status: 400, error: `status invalido. Esperado: ${FUNNEL_STATUSES.join(', ')}` };
    }

    if (status === 'AGUARDANDO_NF') {
      await this.emitToBling(conversationId);
    }

    const conversation = await this.repository.setFunnelStatus(conversationId, status);
    return { ok: true, status: 200, data: { conversationId, funnelStatus: conversation.funnelStatus } };
  }

  /** Ao virar AGUARDANDO_NF, envia o orcamento ao Bling para NF/expedicao. */
  private async emitToBling(conversationId: string): Promise<void> {
    const quote = await this.repository.getQuoteForConversation(conversationId);
    if (!quote) {
      this.logger(`[${conversationId}] sem orcamento vinculado; Bling nao acionado.`);
      return;
    }
    const order = await this.bling.createOrderFromQuote(quote);
    if (order) {
      await this.repository.setQuoteBling(quote.id, order.id, order.numero);
    }
  }
}
