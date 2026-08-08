import { BotStateId } from '../fsm/states.js';
import type { BotStateMachine } from '../fsm/BotStateMachine.js';
import type { SessionState } from './types.js';
import type { PaymentClient } from '../integration/payment/PaymentClient.js';
import { emitCrmEvent } from '../integrations/crm/CrmClient.js';
import type { ICrmClient } from '../integrations/crm/CrmClient.js';

// ============================================================================
// Hook de transicao: ao entrar em PAYMENT_PENDING, cria a cobranca PIX real
// (uma unica vez por sessao) e emite o evento `pix.generated` para o CRM.
// Isolado em modulo proprio para ser testado sem subir o container completo.
// ============================================================================

export interface ChargeOnTransitionDeps {
  payment: PaymentClient;
  crmClient?: ICrmClient;
  merchant?: { name: string; city: string; key: string };
  expiresInMinutes: number;
  makeOrderId?: (ticketId: string) => string;
}

export type OnTransitionHook = (
  session: SessionState,
  fsm: BotStateMachine,
) => Promise<void>;

export function createChargeOnTransition(deps: ChargeOnTransitionDeps): OnTransitionHook {
  return async (session, fsm): Promise<void> => {
    if (fsm.current !== BotStateId.PAYMENT_PENDING || !session.cart || session.charge) {
      return;
    }

    try {
      const orderId =
        deps.makeOrderId?.(session.ticketId) ?? `ORDER-${session.ticketId}-${Date.now()}`;
      const charge = await deps.payment.createPixCharge({
        ticketId: session.ticketId,
        orderId,
        amountCents: session.cart.totalCents,
        description: 'Pedido Loja de Informatica',
        ...(deps.merchant ? { merchant: deps.merchant } : {}),
        expiresInMinutes: deps.expiresInMinutes,
      });

      session.charge = { method: 'pix', chargeId: charge.chargeId, status: charge.status };
      session.chargeExpiresAt = charge.expiresAt;

      emitCrmEvent(deps.crmClient, {
        event: 'pix.generated',
        ticketId: session.ticketId,
        orderId: charge.orderId,
        chargeId: charge.chargeId,
        amountCents: session.cart.totalCents,
        qrCodeBase64: charge.qrCodeBase64,
        emv: charge.emv,
        expiresAt: charge.expiresAt,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[pix] falha ao criar cobranca:', (err as Error).message);
    }
  };
}
