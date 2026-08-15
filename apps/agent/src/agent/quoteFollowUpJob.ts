import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import type { ConversationRecord, IMessageRepository } from '../prisma/MessageRepository.js';

// ============================================================================
// Job de follow-up de orcamentos inativos (ALTA_VALOR):
// varra conversas com orcamento do Monte seu PC vinculado cujo ultimo contato
// superou `inactivityHours` (padrao 24h) e que nao receberam follow-up recente,
// e envia um lembrete amigavel pelo WhatsApp (Evolution API).
// Conversas em atendimento humano (humanMode) sao puladas.
// Nunca lanca: falha vira apenas log.
// ============================================================================

export interface QuoteFollowUpJobOptions {
  repository: IMessageRepository;
  evolution: EvolutionApi;
  /** Horas sem contato para o orcamento ser considerado inativo. */
  inactivityHours?: number;
  intervalMs?: number;
  now?: () => Date;
  logger?: (message: string) => void;
}

export interface QuoteFollowUpJob {
  start(): void;
  stop(): void;
  /** Roda uma varredura manual (usado em testes). Retorna quantos foram notificados. */
  scan(): Promise<number>;
}

export function createQuoteFollowUpJob(options: QuoteFollowUpJobOptions): QuoteFollowUpJob {
  const inactivityHours = options.inactivityHours ?? 24;
  const intervalMs = options.intervalMs ?? 3_600_000;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? (() => undefined);
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function scan(): Promise<number> {
    if (running) return 0;
    running = true;
    let notified = 0;
    try {
      const since = new Date(now().getTime() - inactivityHours * 3_600_000);
      const pending = await options.repository.listPendingFollowUp(since);
      for (const conversation of pending) {
        if (conversation.humanMode || conversation.assignedAgentId) continue;
        const message = buildFollowUpMessage(conversation);
        if (!message) continue;
        await options.evolution.sendText(conversation.whatsappId, message);
        await options.repository.saveOutboundMessage(conversation.id, {
          type: 'text',
          text: message,
          status: 'sent',
        });
        await options.repository.markFollowedUp(conversation.id);
        notified += 1;
        logger(`[${conversation.id}] follow-up enviado (${conversation.quote?.code ?? 'orcamento'} inativo).`);
      }
      return notified;
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void scan().catch(() => undefined);
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    scan,
  };
}

/** Monta o lembrete amigavel de reengajamento para o cliente. */
export function buildFollowUpMessage(
  conversation: Pick<ConversationRecord, 'customerName' | 'quote'>,
): string | null {
  const quote = conversation.quote;
  if (!quote) return null;
  const name = conversation.customerName?.split(' ')[0];
  const greeting = name ? `Olá, ${name}!` : 'Olá!';

  return [
    `${greeting}`,
    '',
    `Ainda está com o orçamento *${quote.code}* da Loja de Informática aberto.`,
    '',
    `Se quiser, confirmo os valores (PIX com 5% de desconto ou cartão em até 12x) e já deixo tudo separado para você.`,
    '',
    'É só responder aqui no WhatsApp. Estamos à disposição!',
  ].join('\n');
}
