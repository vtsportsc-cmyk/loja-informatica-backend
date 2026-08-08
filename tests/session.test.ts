import { describe, it, expect } from 'vitest';
import { InMemorySessionStore } from '../src/agent/InMemorySessionStore.js';
import { RedisSessionStore } from '../src/agent/RedisSessionStore.js';
import type { RedisLike } from '../src/agent/RedisSessionStore.js';
import { BotStateId } from '../src/fsm/states.js';
import type { SessionState } from '../src/agent/types.js';

function makeSession(ticketId = 'TKT-1'): SessionState {
  return {
    ticketId,
    botState: BotStateId.HARDWARE_CHECK,
    customerId: 'CUST-1',
    wishlist: [{ description: 'AMD Ryzen 5 8600G', quantity: 1 }],
    cart: null,
    lockIds: ['LOCK-1'],
    recentMessages: [
      { role: 'user', text: 'oi', at: new Date().toISOString() },
      { role: 'assistant', text: 'olá!', at: new Date().toISOString() },
    ],
    updatedAt: new Date().toISOString(),
  };
}

describe('InMemorySessionStore', () => {
  it('salva, recupera e apaga sessao preservando o estado da FSM', async () => {
    const store = new InMemorySessionStore();
    const session = makeSession();

    await store.save(session);
    const loaded = await store.get('TKT-1');
    expect(loaded?.botState).toBe(BotStateId.HARDWARE_CHECK);
    expect(loaded?.recentMessages).toHaveLength(2);
    expect(loaded?.lockIds).toEqual(['LOCK-1']);

    await store.delete('TKT-1');
    expect(await store.get('TKT-1')).toBeNull();
  });

  it('expira a sessao apos TTL de inatividade (30 min)', async () => {
    let now = 1_000_000;
    const store = new InMemorySessionStore({ ttlMs: 30 * 60 * 1000, now: () => now });
    await store.save(makeSession('TKT-TTL'));

    now += 29 * 60 * 1000;
    expect(await store.get('TKT-TTL')).not.toBeNull();

    now += 2 * 60 * 1000;
    expect(await store.get('TKT-TTL')).toBeNull();
    expect(store.expiredCount).toBe(0); // get() ja descartou
  });

  it('sweepExpired remove sessoes vencidas e all() so lista ativas', async () => {
    let now = 1_000_000;
    const store = new InMemorySessionStore({ ttlMs: 1000, now: () => now });
    await store.save(makeSession('TKT-OLD'));
    await store.save(makeSession('TKT-NEW'));
    now += 2000;

    expect(store.expiredCount).toBe(2);
    expect(store.sweepExpired()).toBe(2);
    expect(store.all()).toHaveLength(0);
    expect(store.expiredCount).toBe(0);
    expect(store.size).toBe(0);
  });

  it('findByOrderId localiza a sessao pelo pedido', async () => {
    const store = new InMemorySessionStore();
    const session = makeSession('TKT-ORD');
    session.orderId = 'ORDER-7001';
    await store.save(session);

    expect(store.findByOrderId('ORDER-7001')?.ticketId).toBe('TKT-ORD');
    expect(store.findByOrderId('ORDER-NAO-EXISTE')).toBeNull();
  });
});

describe('RedisSessionStore (adaptador)', () => {
  class FakeRedis implements RedisLike {
    private readonly data = new Map<string, { value: string; expiresAt: number }>();

    async get(key: string): Promise<string | null> {
      const entry = this.data.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        this.data.delete(key);
        return null;
      }
      return entry.value;
    }

    async set(key: string, value: string, opts?: { ex?: number }): Promise<void> {
      this.data.set(key, {
        value,
        expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : Infinity,
      });
    }

    async del(key: string): Promise<void> {
      this.data.delete(key);
    }

    async keys(pattern: string): Promise<string[]> {
      const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return [...this.data.keys()].filter((k) => re.test(k));
    }
  }

  it('persiste e recupera a sessao serializada com TTL', async () => {
    const redis = new FakeRedis();
    const store = new RedisSessionStore({ client: redis, ttlSeconds: 1800 });
    await store.save(makeSession('TKT-REDIS'));

    const loaded = await store.get('TKT-REDIS');
    expect(loaded?.ticketId).toBe('TKT-REDIS');
    expect(loaded?.botState).toBe(BotStateId.HARDWARE_CHECK);
    expect(loaded?.recentMessages).toHaveLength(2);
  });

  it('all() e findByOrderId() operam sobre as chaves de sessao', async () => {
    const redis = new FakeRedis();
    const store = new RedisSessionStore({ client: redis, ttlSeconds: 1800 });
    const a = makeSession('TKT-A');
    a.orderId = 'ORDER-100';
    await store.save(a);
    await store.save(makeSession('TKT-B'));

    const all = await store.all();
    expect(all).toHaveLength(2);
    expect((await store.findByOrderId('ORDER-100'))?.ticketId).toBe('TKT-A');

    await store.delete('TKT-A');
    expect(await store.all()).toHaveLength(1);
  });
});
