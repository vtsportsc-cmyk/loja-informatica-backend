import type { RedisLike } from '../agent/RedisSessionStore.js';

// ============================================================================
// Camada de cache (Redis) para respostas institucionais frequentes.
// Se a intencao do cliente casar com uma duvida institucional (endereco,
// horario, pagamento, garantia...), a resposta e servida deste cache SEM
// consumir tokens da LLM. Sem cliente Redis injetado, cai em memoria (dev/teste).
// ============================================================================

export const INSTITUTIONAL_CACHE_PREFIX = 'institutional:';

export interface InstitutionalCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export class RedisInstitutionalCache implements InstitutionalCache {
  constructor(private readonly client: RedisLike) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(this.key(key));
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(this.key(key), value, { ex: ttlSeconds });
  }

  private key(id: string): string {
    return `${INSTITUTIONAL_CACHE_PREFIX}${id}`;
  }
}

/** Fallback em memoria (sem Redis). Nao expira por TTL real; usa janela de tempo. */
export class MemoryInstitutionalCache implements InstitutionalCache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly defaultTtlSeconds = 43_200) {}

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(this.key(key));
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(this.key(key));
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(this.key(key), { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  private key(id: string): string {
    return `${INSTITUTIONAL_CACHE_PREFIX}${id}`;
  }
}

export function createInstitutionalCache(client?: RedisLike): InstitutionalCache {
  return client ? new RedisInstitutionalCache(client) : new MemoryInstitutionalCache();
}
