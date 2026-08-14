import type { SessionState, SessionStore } from './types.js';
import { BotStateId } from '../fsm/states.js';

// ============================================================================
// Job de expiracao de PIX: varre sessoes em PAYMENT_PENDING cuja cobranca
// expirou, libera os locks de estoque no ERP e devolve o ticket para
// STOCK_AND_FREIGHT (FSM PAYMENT_EXPIRED).
// ============================================================================

export interface PaymentExpiryJobOptions {
  sessionStore: SessionStore;
  /** Responsavel por aplicar PAYMENT_EXPIRED no ticket (ex.: PaymentWebhookProcessor.expire). */
  expire: (ticketId: string) => Promise<unknown>;
  intervalMs?: number;
  now?: () => Date;
}

export interface PaymentExpiryJob {
  start(): void;
  stop(): void;
  /** Roda uma varredura manual (usado em testes). */
  scan(): Promise<number>;
}

export function createPaymentExpiryJob(options: PaymentExpiryJobOptions): PaymentExpiryJob {
  const intervalMs = options.intervalMs ?? 15_000;
  const now = options.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function scan(): Promise<number> {
    if (running) return 0;
    running = true;
    let expired = 0;
    try {
      const all = (options.sessionStore as SessionStore & { all?: () => SessionState[] | Promise<SessionState[]> }).all;
      const sessions = (await all?.call(options.sessionStore)) ?? [];
      const nowMs = now().getTime();
      for (const session of sessions) {
        if (session.botState !== BotStateId.PAYMENT_PENDING) continue;
        const expiresAt = session.chargeExpiresAt ?? maxLockExpiry(session);
        if (expiresAt && new Date(expiresAt).getTime() < nowMs) {
          try {
            await options.expire(session.ticketId);
            expired += 1;
          } catch {
            // ticket pode ter sido confirmado entre a varredura e o expire
          }
        }
      }
      return expired;
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

function maxLockExpiry(session: SessionState): string | undefined {
  const dates = (session.cart?.items ?? [])
    .map((i) => i.lockExpiresAt)
    .filter((d): d is string => Boolean(d));
  if (dates.length === 0) return undefined;
  return dates.reduce((a, b) => (a > b ? a : b), '');
}
