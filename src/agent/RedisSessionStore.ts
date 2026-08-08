import type { ISessionStore, SessionState } from './types.js';

// ============================================================================
// RedisSessionStore - adaptador de persistencia de sessao em Redis.
// Implementa a mesma interface ISessionStore usada em memoria; o cliente
// Redis e injetado (via BuildContainerOptions.redisClient) para nao criar
// dependencia de rede nos testes. Cada sessao vira uma chave `session:<ticket>`
// serializada em JSON com TTL de inatividade.
// ============================================================================

export const SESSION_KEY_PREFIX = 'session:';

/** Subconjunto minimo do cliente Redis usado pelo store (compativel com ioredis/node-redis). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

export interface RedisSessionStoreOptions {
  client: RedisLike;
  /** TTL de inatividade em segundos (default 1800 = 30 min). */
  ttlSeconds?: number;
}

export class RedisSessionStore implements ISessionStore {
  private readonly client: RedisLike;
  private readonly ttlSeconds: number;

  constructor(options: RedisSessionStoreOptions) {
    this.client = options.client;
    this.ttlSeconds = options.ttlSeconds ?? 1800;
  }

  async get(ticketId: string): Promise<SessionState | null> {
    const raw = await this.client.get(this.key(ticketId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionState;
    } catch {
      return null;
    }
  }

  async save(session: SessionState): Promise<void> {
    await this.client.set(this.key(session.ticketId), JSON.stringify(session), {
      ex: this.ttlSeconds,
    });
  }

  async delete(ticketId: string): Promise<void> {
    await this.client.del(this.key(ticketId));
  }

  async all(): Promise<SessionState[]> {
    const keys = await this.client.keys(`${SESSION_KEY_PREFIX}*`);
    const sessions: SessionState[] = [];
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (!raw) continue;
      try {
        sessions.push(JSON.parse(raw) as SessionState);
      } catch {
        // chave corrompida: ignora
      }
    }
    return sessions;
  }

  async findByOrderId(orderId: string): Promise<SessionState | null> {
    for (const session of await this.all()) {
      if (session.orderId === orderId) return session;
    }
    return null;
  }

  private key(ticketId: string): string {
    return `${SESSION_KEY_PREFIX}${ticketId}`;
  }
}
