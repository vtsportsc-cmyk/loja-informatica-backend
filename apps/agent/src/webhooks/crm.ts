import { crmFollowUpSchema } from '../integrations/crm/types.js';
import type { CrmFollowUp } from '../integrations/crm/types.js';
import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import type { SessionStore } from '../agent/types.js';
import type { BotStateId } from '../fsm/states.js';

// ============================================================================
// Webhook do CRM para follow-up (reengajamento de vendas): o "Agente Duradouro"
// chama POST /webhooks/crm/follow-up quando detecta, por exemplo, carrinho
// parado ha +2 horas. O handler valida o payload, recupera a sessao no
// SessionStore e dispara a mensagem de reengajamento via Evolution API.
// ============================================================================

export interface CrmFollowUpDeps {
  sessionStore: SessionStore;
  evolution: EvolutionApi;
}

export interface CrmFollowUpResult {
  ok: boolean;
  ticketId: string;
  reason?: 'session_not_found';
  botState?: BotStateId;
}

export class CrmFollowUpHandler {
  private readonly sessionStore: SessionStore;
  private readonly evolution: EvolutionApi;

  constructor(deps: CrmFollowUpDeps) {
    this.sessionStore = deps.sessionStore;
    this.evolution = deps.evolution;
  }

  async handle(rawBody: string): Promise<CrmFollowUpResult> {
    const payload = crmFollowUpSchema.parse(JSON.parse(rawBody)) as CrmFollowUp;

    const session = await this.sessionStore.get(payload.ticketId);
    if (!session) {
      return { ok: false, ticketId: payload.ticketId, reason: 'session_not_found' };
    }

    await this.evolution.sendReply({
      ticketId: payload.ticketId,
      channel: 'whatsapp',
      type: 'text',
      text: payload.message ?? defaultFollowUpMessage(payload),
    });

    return { ok: true, ticketId: payload.ticketId, botState: session.botState };
  }
}

function defaultFollowUpMessage(payload: CrmFollowUp): string {
  switch (payload.reason) {
    case 'abandoned_cart':
      return 'Ola! Notei que voce deixou seu carrinho na loja. Quer continuar o pedido? Posso finalizar agora mesmo via PIX.';
    case 'pix_expired_followup':
      return 'Ola! Sua cobranca PIX expirou. Se quiser, posso gerar uma nova ou ajustar o carrinho.';
    default:
      return 'Ola! Vi que ficamos com seu atendimento pendente. Posso ajudar a concluir seu pedido?';
  }
}
