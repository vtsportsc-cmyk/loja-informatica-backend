import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import type { ConversationRecord, IMessageRepository } from '../prisma/MessageRepository.js';

// ============================================================================
// Automacao por mudanca de estagio do funil.
// Hook chamado sempre que uma conversa e movida para um estagio relevante:
//   * ALTA_VALOR    -> resumo do orcamento + instrucoes de pagamento (PIX/parcela);
//   * AGUARDANDO_NF -> confirmacao de pagamento + separacao e emissao da NF.
// A mensagem e enviada via Evolution API (WhatsApp) e registrada como
// outbound no PostgreSQL, para o painel de CRM mostrar no historico.
// Nunca lanca: falha vira apenas log (nunca bloqueia o painel nem o webhook).
// ============================================================================

export interface FunnelAutomationDeps {
  repository: IMessageRepository;
  evolution: EvolutionApi;
  logger?: (message: string) => void;
}

export type FunnelStatusChangeHook = (
  conversationId: string,
  status: string,
) => Promise<void>;

export function createFunnelAutomation(deps: FunnelAutomationDeps): FunnelStatusChangeHook {
  return async (conversationId, status): Promise<void> => {
    try {
      const conversation = await deps.repository.getConversationById(conversationId);
      if (!conversation) return;

      const message = buildFunnelMessage(status, conversation);
      if (!message) return;

      await deps.evolution.sendText(conversation.whatsappId, message);
      await deps.repository.saveOutboundMessage(conversationId, {
        type: 'text',
        text: message,
        status: 'sent',
      });
      deps.logger?.(`[${conversationId}] automacao do funil disparada (${status}).`);
    } catch (err) {
      deps.logger?.(`[${conversationId}] falha na automacao do funil (${status}): ${(err as Error).message}`);
    }
  };
}

/** Monta a mensagem formatada para o cliente conforme o estagio do funil. */
export function buildFunnelMessage(
  status: string,
  conversation: Pick<ConversationRecord, 'customerName' | 'quote'>,
): string | null {
  switch (status) {
    case 'ALTA_VALOR':
      return highValueMessage(conversation);
    case 'AGUARDANDO_NF':
      return awaitingInvoiceMessage(conversation);
    default:
      return null;
  }
}

function highValueMessage(
  conversation: Pick<ConversationRecord, 'customerName' | 'quote'>,
): string {
  const name = conversation.customerName?.split(' ')[0];
  const quote = conversation.quote;
  const greeting = name ? `Olá, ${name}!` : 'Olá!';

  if (!quote) {
    return `${greeting}\n\nIdentificamos que você tem um orçamento em andamento na Loja de Informática. Quando quiser, podemos confirmar valores e formas de pagamento (PIX com 5% de desconto ou cartão em até 12x). Estamos à disposição!`;
  }

  const lines = quote.items
    .slice(0, 8)
    .map((item) => `• ${item.quantity}x ${item.name}`);
  if (quote.items.length > 8) lines.push(`• e mais ${quote.items.length - 8} itens...`);

  return [
    `${greeting}`,
    '',
    `Recebemos o seu orçamento *${quote.code}* da Loja de Informática:`,
    ...lines,
    '',
    `*Valores:*`,
    `Subtotal: ${formatBRL(quote.totalCents)}`,
    `PIX (5% off): *${formatBRL(quote.pixTotalCents)}*`,
    `Cartão: ${quote.installments}x de ${formatBRL(quote.monthlyValueCents)}`,
    '',
    `Para pagar, é só confirmar aqui no WhatsApp que geramos o *PIX* (validade de 30 min) ou enviamos o link de cartão.`,
    '',
    'Estamos à disposição!',
  ].join('\n');
}

function awaitingInvoiceMessage(
  conversation: Pick<ConversationRecord, 'customerName' | 'quote'>,
): string {
  const name = conversation.customerName?.split(' ')[0];
  const quote = conversation.quote;
  const greeting = name ? `Olá, ${name}!` : 'Olá!';
  const orderCode = quote ? ` (${quote.code})` : '';

  return [
    `${greeting}`,
    '',
    `Pagamento confirmado${orderCode}! Recebemos o valor e já estamos providenciando a separação do seu pedido.`,
    '',
    'A nota fiscal será emitida em até 24h úteis e enviaremos o link de rastreio assim que o produto for despachado.',
    '',
    'Obrigado pela compra! Qualquer dúvida, é só chamar.',
  ].join('\n');
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
