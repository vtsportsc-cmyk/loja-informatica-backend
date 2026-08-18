import {
  DEPARTMENTS,
  FUNNEL_STATUSES,
  LEAD_SOURCES,
  LOST_REASONS,
  isDepartment,
  isFunnelStatus,
  isLeadSource,
  isLostReason,
} from '@loja/db';
import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import type { BlingOrderService } from '../integration/bling/BlingOrderService.js';
import type { IMessageRepository } from '../prisma/MessageRepository.js';
import type { FunnelStatusChangeHook } from '../agent/funnelAutomation.js';

// ============================================================================
// API REST consumida pelo Painel de CRM (apps/app -> apps/agent).
// Aplicacoes:
//   POST /api/messages                      -> vendedor envia msg ao cliente
//   POST /api/conversations/:id/handoff     -> assumir / liberar atendimento
//   POST /api/conversations/:id/status      -> mover status do funil (e Bling)
//   POST /api/conversations/:id/department  -> atribuir departamento/atendente
//   POST /api/conversations/:id/source      -> definir origem do lead
//   POST /api/conversations/:id/lost        -> marcar como perdido (CANCELADO)
//   POST /api/conversations/:id/notes       -> registrar anotacao interna
//   GET  /api/agents                        -> lista de atendentes ativos
// Todas exigem o header `x-agent-key` (AGENT_API_KEY).
// ============================================================================

export interface PanelApiDeps {
  repository: IMessageRepository;
  evolution: EvolutionApi;
  bling: BlingOrderService;
  apiKey: string;
  /** Automacao por mudanca de estagio do funil (ALTA_VALOR / AGUARDANDO_NF). */
  funnelAutomation?: FunnelStatusChangeHook;
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
  private readonly funnelAutomation?: FunnelStatusChangeHook;
  private readonly logger: (message: string) => void;

  constructor(deps: PanelApiDeps) {
    this.repository = deps.repository;
    this.evolution = deps.evolution;
    this.bling = deps.bling;
    this.apiKey = deps.apiKey;
    this.funnelAutomation = deps.funnelAutomation;
    this.logger = deps.logger ?? ((m) => console.log(`[panel] ${m}`));
  }

  checkAuth(key: string | undefined): boolean {
    return Boolean(this.apiKey) && key === this.apiKey;
  }

  async listConversations(opts?: { cursor?: string; limit?: number }): Promise<PanelApiResult> {
    const result = await this.repository.listConversations(opts);
    return { ok: true, status: 200, data: result };
  }

  async getConversation(conversationId: string): Promise<PanelApiResult> {
    const conversation = await this.repository.getConversationById(conversationId);
    if (!conversation) {
      return { ok: false, status: 404, error: 'conversa nao encontrada' };
    }
    const messagesResult = await this.repository.listMessages(conversationId);
    const timeline = await this.repository.listTimeline(conversationId);
    const notes = await this.repository.listNotes(conversationId);
    return { ok: true, status: 200, data: { conversation, messages: messagesResult.items, timeline, notes } };
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
    void this.funnelAutomation?.(conversationId, status);
    return { ok: true, status: 200, data: { conversationId, funnelStatus: conversation.funnelStatus } };
  }

  async setLeadSource(conversationId: string, body: unknown): Promise<PanelApiResult> {
    const { leadSource } = body as { leadSource?: string | null };
    if (leadSource !== null && leadSource !== undefined && !isLeadSource(leadSource)) {
      return { ok: false, status: 400, error: `origem do lead invalida. Esperado: ${LEAD_SOURCES.join(', ')}` };
    }
    const conversation = await this.repository.setLeadSource(conversationId, leadSource ?? null);
    this.logger(`[${conversationId}] origem do lead definida como ${conversation.leadSource ?? 'n/a'}.`);
    return { ok: true, status: 200, data: { conversationId, leadSource: conversation.leadSource } };
  }

  async markLost(conversationId: string, body: unknown): Promise<PanelApiResult> {
    const { lostReason } = body as { lostReason?: string };
    if (!lostReason || !isLostReason(lostReason)) {
      return { ok: false, status: 400, error: `motivo de perda invalido. Esperado: ${LOST_REASONS.join(', ')}` };
    }
    const conversation = await this.repository.markLost(conversationId, lostReason);
    this.logger(`[${conversationId}] conversa marcada como perdida (${lostReason}).`);
    return {
      ok: true,
      status: 200,
      data: { conversationId, funnelStatus: conversation.funnelStatus, lostReason: conversation.lostReason },
    };
  }

  async addNote(conversationId: string, body: unknown): Promise<PanelApiResult> {
    const { agentId, text } = body as { agentId?: string; text?: string };
    if (!text?.trim()) {
      return { ok: false, status: 400, error: 'text e obrigatorio' };
    }
    const note = await this.repository.addNote(conversationId, { agentId: agentId ?? null, text });
    this.logger(`[${conversationId}] anotacao interna registrada por ${agentId ?? 'n/a'}.`);
    return { ok: true, status: 200, data: { note } };
  }

  async listAgents(): Promise<PanelApiResult> {
    const agents = await this.repository.listAgents();
    return { ok: true, status: 200, data: { agents } };
  }

  async assignDepartment(conversationId: string, body: unknown): Promise<PanelApiResult> {
    const { department, assignedAgentId } = body as {
      department?: string | null;
      assignedAgentId?: string | null;
    };
    if (department !== undefined && department !== null && !isDepartment(department)) {
      return { ok: false, status: 400, error: `departamento invalido. Esperado: ${DEPARTMENTS.join(', ')}` };
    }

    const conversation = await this.repository.getConversationById(conversationId);
    if (!conversation) {
      return { ok: false, status: 404, error: 'conversa nao encontrada' };
    }

    if (assignedAgentId !== undefined && assignedAgentId !== null) {
      const agents = await this.repository.listAgents();
      if (!agents.some((a) => a.id === assignedAgentId)) {
        return { ok: false, status: 400, error: 'atendente nao encontrado' };
      }
    }

    const updated = await this.repository.setDepartment(conversationId, {
      department: department === undefined ? undefined : department,
      assignedAgentId: assignedAgentId === undefined ? undefined : assignedAgentId,
    });
    this.logger(`[${conversationId}] departamento=${updated.department ?? 'n/a'} atendente=${updated.assignedAgentId ?? 'n/a'}`);
    return {
      ok: true,
      status: 200,
      data: { conversationId, department: updated.department, assignedAgentId: updated.assignedAgentId },
    };
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
