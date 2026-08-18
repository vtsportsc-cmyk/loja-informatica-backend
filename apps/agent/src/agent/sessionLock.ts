// ============================================================================
// Lock de sessao por ticket: garante que mensagens do mesmo atendimento sejam
// processadas em serie (uma de cada vez), sem corrida no estado da FSM/carrinho.
//
// TTL + watchdog (fix B2/R2 do relatorio de auditoria): se quem adquiriu o lock
// nunca chamar release() (crash do processo, promise abandonada, excecao nao
// tratada fora do try/finally do caller), a ticket ficaria travada para sempre e
// as mensagens daquele cliente enfileirariam infinitamente. Cada aquisicao ganha
// um token; um timer forca a liberacao apos `ttlMs` caso o token ainda seja o
// dono do lock. O token evita a liberacao "fantasma": se o release() legitimo
// (ou um watchdog anterior) ja passou a posse adiante, uma chamada tardia a
// release() vira no-op em vez de derrubar o lock de outro caller (problema ABA).
// ============================================================================

const DEFAULT_TTL_MS = 60_000;

export interface SessionLockOptions {
  /** Tempo maximo (ms) que um caller pode segurar o lock antes do watchdog forcar a liberacao. */
  ttlMs?: number;
  /** Chamado quando o watchdog precisa forcar a liberacao (lock nunca foi devolvido a tempo). */
  onForceRelease?: (key: string) => void;
}

export class SessionLock {
  private readonly ttlMs: number;
  private readonly onForceRelease: (key: string) => void;
  /** Token do detentor atual do lock, por chave. Ausente = chave livre. */
  private readonly holders = new Map<string, number>();
  private readonly queues = new Map<string, Array<() => void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private tokenSeq = 0;

  constructor(options: SessionLockOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.onForceRelease =
      options.onForceRelease ??
      ((key) => console.warn(`[sessionLock] watchdog forcou liberacao da ticket "${key}" (TTL excedido).`));
  }

  /** Aguarda a sessao ficar livre e devolve a funcao de liberacao. */
  acquire(key: string): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        const token = ++this.tokenSeq;
        this.holders.set(key, token);
        this.armWatchdog(key, token);
        resolve(() => this.release(key, token));
      };

      if (!this.holders.has(key)) {
        grant();
        return;
      }
      const queue = this.queues.get(key) ?? [];
      queue.push(grant);
      this.queues.set(key, queue);
    });
  }

  private armWatchdog(key: string, token: number): void {
    const timer = setTimeout(() => {
      if (this.holders.get(key) !== token) return; // ja liberado normalmente; watchdog obsoleto
      this.onForceRelease(key);
      this.advance(key);
    }, this.ttlMs);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private release(key: string, token: number): void {
    if (this.holders.get(key) !== token) return; // watchdog ja liberou; release tardio vira no-op
    this.clearWatchdog(key);
    this.advance(key);
  }

  private advance(key: string): void {
    this.holders.delete(key);
    const queue = this.queues.get(key);
    const next = queue?.shift();
    if (next) {
      next();
      return;
    }
    this.queues.delete(key);
  }

  private clearWatchdog(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}
