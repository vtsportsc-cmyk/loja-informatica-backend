import { describe, it, expect } from 'vitest';
import { Metrics } from '../src/observability/metrics.js';
import { SlidingWindowRateLimiter } from '../src/agent/rateLimiter.js';
import { SessionLock } from '../src/agent/sessionLock.js';
import { BotStateId } from '../src/fsm/states.js';

describe('Metrics - observabilidade', () => {
  it('acumula chamadas de LLM por provider/modelo', () => {
    const metrics = new Metrics();
    metrics.recordLlmCall({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      ok: true,
      elapsedMs: 120,
      promptTokens: 10,
      completionTokens: 5,
      failover: false,
      retried: false,
    });
    metrics.recordLlmCall({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      ok: false,
      elapsedMs: 3000,
      errorCode: 'timeout',
      failover: true,
      retried: false,
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.llm).toHaveLength(1);
    const entry = snapshot.llm[0];
    expect(entry.calls).toBe(2);
    expect(entry.errors).toBe(1);
    expect(entry.failovers).toBe(1);
    expect(entry.latencyMs).toBe(3120);
  });

  it('registra failovers por motivo, transicoes e outcomes terminais', () => {
    const metrics = new Metrics();
    metrics.recordProviderChange({ from: 'groq', to: 'gemini', reason: 'timeout', retryAttempt: 1 });
    metrics.recordProviderChange({ from: 'gemini', to: 'groq', reason: 'recovered', retryAttempt: 0 });
    metrics.recordTransition(BotStateId.GREETING, BotStateId.HARDWARE_CHECK);
    metrics.recordTerminalOutcome(BotStateId.PAYMENT_CONFIRMED);
    metrics.recordWebhook('payment.confirmed', true);
    metrics.recordRateLimited('TKT-1');

    const snapshot = metrics.snapshot();
    expect(snapshot.failoversByReason).toEqual({ timeout: 1 });
    expect(snapshot.recoveries).toBe(1);
    expect(snapshot.transitions).toEqual({ 'GREETING->HARDWARE_CHECK': 1 });
    expect(snapshot.terminalOutcomes).toEqual({ PAYMENT_CONFIRMED: 1 });
    expect(snapshot.webhooks).toEqual({ 'payment.confirmed:ok': 1 });
    expect(snapshot.totalRateLimited).toBe(1);
  });

  it('gera output Prometheus valido', () => {
    const metrics = new Metrics();
    metrics.recordLlmCall({
      provider: 'groq',
      model: 'mock',
      ok: true,
      elapsedMs: 50,
      failover: false,
      retried: false,
    });
    const out = metrics.toPrometheus();
    expect(out).toContain('llm_calls_total{provider="groq",model="mock"} 1');
    expect(out).toContain('rate_limited_total 0');
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('bloqueia apos exceder o limite na janela', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    const third = limiter.check('a');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeDefined();
    // outra chave continua livre
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('libera apos passar a janela', async () => {
    const limiter = new SlidingWindowRateLimiter(1, 20);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(limiter.check('a').allowed).toBe(true);
  });
});

describe('SessionLock - serializacao por ticket', () => {
  it('serializa processamentos concorrentes da mesma chave', async () => {
    const lock = new SessionLock();
    const order: string[] = [];
    const run = async (id: string) => {
      const release = await lock.acquire('TKT-1');
      try {
        order.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-${id}`);
      } finally {
        release();
      }
    };

    await Promise.all([run('a'), run('b'), run('c')]);
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
  });
});
