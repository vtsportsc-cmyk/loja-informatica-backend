// ============================================================================
// Lock de sessao por ticket: garante que mensagens do mesmo atendimento sejam
// processadas em serie (uma de cada vez), sem corrida no estado da FSM/carrinho.
// ============================================================================

export class SessionLock {
  private readonly locks = new Set<string>();
  private readonly queues = new Map<string, Array<() => void>>();

  /** Aguarda a sessao ficar livre e devolve a funcao de liberacao. */
  acquire(key: string): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locks.has(key)) {
        this.locks.add(key);
        resolve(() => this.release(key));
        return;
      }
      const queue = this.queues.get(key) ?? [];
      queue.push(() => {
        this.locks.add(key);
        resolve(() => this.release(key));
      });
      this.queues.set(key, queue);
    });
  }

  private release(key: string): void {
    const queue = this.queues.get(key);
    const next = queue?.shift();
    if (next) {
      next();
      return;
    }
    this.locks.delete(key);
    this.queues.delete(key);
  }
}
