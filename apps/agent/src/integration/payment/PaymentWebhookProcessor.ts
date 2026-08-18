import { PaymentClient } from './PaymentClient.js';
import type { ErpClient } from '../erp/ErpClient.js';
import type { EvolutionApi } from '../evolution/EvolutionApi.js';
import { BotStateMachine } from '../../fsm/BotStateMachine.js';
import { BotStateId } from '../../fsm/states.js';
import type { SessionState, SessionStore } from '../../agent/types.js';
import type { PaymentNotification } from '../../types/index.js';
import { Metrics } from '../../observability/metrics.js';
import { emitCrmEvent } from '../../integrations/crm/CrmClient.js';
import type { ICrmClient } from '../../integrations/crm/CrmClient.js';

export interface PaymentWebhookProcessorOptions {
  paymentClient: PaymentClient;
  erpClient: ErpClient;
  evolution: EvolutionApi;
  sessionStore: SessionStore;
  getCustomer?: (session: SessionState) => { name: string; phone: string };
  metrics?: Metrics;
  crmClient?: ICrmClient;
}

export interface PaymentWebhookResult {
  orderId: string;
  orderStatus: 'awaiting_nf';
  botState: BotStateId;
}

export interface PaymentExpiryResult {
  status: 'expired' | 'cancelled' | 'ignored' | 'session_not_found';
  botState: BotStateId;
  releasedLocks: string[];
}

// Processa a confirmacao de pagamento:
// FSM PAYMENT_PENDING -> PAYMENT_CONFIRMED, cria pedido "Aguardando NF" no ERP
// e notifica o vendedor via Evolution API (WhatsApp). O vendedor fica
// responsavel pela separacao fisica e emissao da NF.
export class PaymentWebhookProcessor {
  private readonly paymentClient: PaymentClient;
  private readonly erpClient: ErpClient;
  private readonly evolution: EvolutionApi;
  private readonly sessionStore: SessionStore;
  private readonly metrics: Metrics;
  private readonly crmClient?: ICrmClient;
  private readonly getCustomer: NonNullable<PaymentWebhookProcessorOptions['getCustomer']>;

  constructor(options: PaymentWebhookProcessorOptions) {
    this.paymentClient = options.paymentClient;
    this.erpClient = options.erpClient;
    this.evolution = options.evolution;
    this.sessionStore = options.sessionStore;
    this.metrics = options.metrics ?? new Metrics();
    this.crmClient = options.crmClient;
    this.getCustomer =
      options.getCustomer ??
      ((session) => ({
        name: session.customerId,
        phone: session.customerId,
      }));
  }

  async process(rawBody: string, signatureHeader?: string): Promise<PaymentWebhookResult> {
    const notification = await this.paymentClient.handleNotification(rawBody, signatureHeader);
    this.metrics.recordWebhook(notification.event, notification.event === 'payment.confirmed');

    if (notification.event !== 'payment.confirmed') {
      throw new PaymentNotConfirmedError(notification);
    }

    const session = await this.loadSession(notification);
    const fsm = new BotStateMachine({ initialState: session.botState });

    fsm.transition({ type: 'PAYMENT_CONFIRMED', orderId: notification.orderId });

    const customer = this.getCustomer(session);
    const order = await this.createOrderWithRetry({
      ticketId: session.ticketId,
      customer: {
        name: customer.name,
        phone: customer.phone,
      },
      lines: (session.cart?.items ?? []).map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lockId: item.lockId ?? '',
      })),
      paymentMethod: notification.method,
      status: 'awaiting_nf',
      totalCents: notification.amountCents,
      meta: {
        chargeId: notification.chargeId,
        botStateBefore: session.botState,
        orderId: notification.orderId,
      },
    });

    if (!order) {
      session.botState = BotStateId.PAYMENT_PENDING;
      await this.sessionStore.save(session);
      await this.evolution.sendReply({
        ticketId: session.ticketId,
        channel: 'whatsapp',
        type: 'text',
        text: 'Pagamento confirmado! Tivemos uma dificuldade temporaria ao registrar o pedido. Um vendedor vai te ajudar em breve para concluir.',
      });
      this.metrics.recordWebhook('payment.erp_failure', false);
      throw new PaymentErpFailureError(notification);
    }

    session.orderId = order.orderId;
    session.botState = fsm.current;
    await this.sessionStore.save(session);

    emitCrmEvent(this.crmClient, {
      event: 'sale.completed',
      ticketId: session.ticketId,
      orderId: order.orderId,
      chargeId: notification.chargeId,
      amountCents: notification.amountCents,
      method: notification.method,
      createdAt: new Date().toISOString(),
    });

    await this.evolution.sendReply({
      ticketId: session.ticketId,
      channel: 'whatsapp',
      type: 'text',
      text: `Pagamento confirmado! Pedido ${order.orderId} criado. Um vendedor fara a separacao e emitira a nota fiscal em breve.`,
    });

    return { orderId: order.orderId, orderStatus: 'awaiting_nf', botState: fsm.current };
  }

  private async loadSession(notification: PaymentNotification): Promise<SessionState> {
    if (notification.ticketId) {
      const session = await this.sessionStore.get(notification.ticketId);
      if (session) return session;
    }
    throw new PaymentSessionNotFoundError(notification);
  }

  /** Cobranca PIX expirou: libera o estoque e volta para STOCK_AND_FREIGHT. */
  async expire(ticketId: string): Promise<PaymentExpiryResult> {
    return this.paymentLifecycle(ticketId, 'expired');
  }

  /** Cliente desistiu no checkout: libera o estoque e volta para STOCK_AND_FREIGHT. */
  async cancel(ticketId: string): Promise<PaymentExpiryResult> {
    return this.paymentLifecycle(ticketId, 'cancelled');
  }

  private async paymentLifecycle(
    ticketId: string,
    kind: 'expired' | 'cancelled',
  ): Promise<PaymentExpiryResult> {
    const session = await this.sessionStore.get(ticketId);
    if (!session) {
      return { status: 'session_not_found', botState: BotStateId.GREETING, releasedLocks: [] };
    }
    if (session.botState !== BotStateId.PAYMENT_PENDING) {
      return { status: 'ignored', botState: session.botState, releasedLocks: [] };
    }

    const releasedLocks = await this.releaseLocks(session, kind);

    if (kind === 'expired') {
      emitCrmEvent(this.crmClient, {
        event: 'pix.expired',
        ticketId,
        chargeId: session.charge?.chargeId,
        orderId: session.orderId,
        amountCents: session.cart?.totalCents,
        expiresAt: session.chargeExpiresAt,
        createdAt: new Date().toISOString(),
      });
    }

    const fsm = new BotStateMachine({ initialState: session.botState });
    fsm.transition({ type: kind === 'expired' ? 'PAYMENT_EXPIRED' : 'PAYMENT_CANCELLED' });

    session.botState = fsm.current;
    session.charge = undefined;
    session.chargeExpiresAt = undefined;
    session.lockIds = [];
    await this.sessionStore.save(session);

    await this.evolution.sendReply({
      ticketId,
      channel: 'whatsapp',
      type: 'text',
      text:
        kind === 'expired'
          ? 'Sua cobranca PIX expirou. Se quiser, posso gerar uma nova ou ajustar o carrinho.'
          : 'Certo, pedido cancelado. Se mudar de ideia, e so me chamar!',
    });
    this.metrics.recordWebhook(`charge.${kind}`, true);
    return { status: kind, botState: fsm.current, releasedLocks };
  }

  private async releaseLocks(session: SessionState, kind: 'expired' | 'cancelled'): Promise<string[]> {
    const released: string[] = [];
    for (const lockId of session.lockIds) {
      try {
        await this.erpClient.releaseLock(lockId, kind === 'expired' ? 'timeout' : 'cancelled');
        released.push(lockId);
      } catch {
        // trava pode ja ter expirado no ERP; segue o fluxo
      }
    }
    return released;
  }

  private async createOrderWithRetry(
    orderData: Parameters<ErpClient['createOrder']>[0],
    maxRetries = 3,
  ): Promise<{ orderId: string } | null> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.erpClient.createOrder(orderData);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delayMs = 500 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    console.error(
      `[payment] ERP createOrder falhou apos ${maxRetries} tentativas:`,
      (lastError as Error).message,
    );
    return null;
  }
}

export class PaymentWebhookError extends Error {
  readonly notification: PaymentNotification;
  constructor(notification: PaymentNotification, message: string) {
    super(message);
    this.name = 'PaymentWebhookError';
    this.notification = notification;
  }
}

export class PaymentNotConfirmedError extends PaymentWebhookError {
  constructor(notification: PaymentNotification) {
    super(notification, `Evento de pagamento nao confirmado: ${notification.event}`);
    this.name = 'PaymentNotConfirmedError';
  }
}

export class PaymentSessionNotFoundError extends PaymentWebhookError {
  constructor(notification: PaymentNotification) {
    super(
      notification,
      `Nenhuma sessao encontrada para a notificacao de pagamento (orderId=${notification.orderId}, ticketId=${notification.ticketId ?? 'n/a'})`,
    );
    this.name = 'PaymentSessionNotFoundError';
  }
}

export class PaymentErpFailureError extends PaymentWebhookError {
  constructor(notification: PaymentNotification) {
    super(
      notification,
      `Falha ao criar pedido no ERP apos multiplas tentativas (orderId=${notification.orderId})`,
    );
    this.name = 'PaymentErpFailureError';
  }
}
