import type { ISessionStore, SessionState } from './types.js';

// ============================================================================
// Persistencia de contexto da conversa em memoria, com TTL de inatividade.
// Ao expirar (30 min sem interacao, configurável), a sessao pendente e
// descartada e o estoque trava e liberado pelo PaymentExpiryJob/ERP.
// Em producao, use RedisSessionStore (mesma interface).
// ============================================================================
export interface InMemorySessionStoreOptions {
  /** TTL de inatividade em ms (0 = sem expiracao). Default 0. */
  ttlMs?: number;
  now?: () => number;
}

interface Entry {
  session: SessionState;
  expiresAt: number;
}

export class InMemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: InMemorySessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 0;
    this.now = options.now ?? Date.now;
  }

  async get(ticketId: string): Promise<SessionState | null> {
    const entry = this.sessions.get(ticketId);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.sessions.delete(ticketId);
      return null;
    }
    return entry.session;
  }

  async save(session: SessionState): Promise<void> {
    const now = this.now();
    const expiresAt = this.ttlMs > 0 ? now + this.ttlMs : Infinity;
    this.sessions.set(session.ticketId, { session: { ...session, updatedAt: new Date().toISOString() }, expiresAt });
  }

  async delete(ticketId: string): Promise<void> {
    this.sessions.delete(ticketId);
  }

  all(): SessionState[] {
    const out: SessionState[] = [];
    for (const [key, entry] of this.sessions) {
      if (this.isExpired(entry)) {
        this.sessions.delete(key);
        continue;
      }
      out.push(entry.session);
    }
    return out;
  }

  findByOrderId(orderId: string): SessionState | null {
    for (const entry of this.sessions.values()) {
      if (this.isExpired(entry)) continue;
      if (entry.session.orderId === orderId) return entry.session;
    }
    return null;
  }

  /** Descarta sessoes vencidas; retorna quantas foram expiradas. */
  sweepExpired(): number {
    let removed = 0;
    for (const [key, entry] of this.sessions) {
      if (this.isExpired(entry)) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get expiredCount(): number {
    let count = 0;
    for (const entry of this.sessions.values()) {
      if (this.isExpired(entry)) count += 1;
    }
    return count;
  }

  get size(): number {
    return this.all().length;
  }

  private isExpired(entry: Entry): boolean {
    return this.ttlMs > 0 && this.now() >= entry.expiresAt;
  }
}
