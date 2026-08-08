// ============================================================================
// Rate limit por cliente/ticket: janela deslizante em memoria.
// Evita que um ticket inunde o atendimento e dispare chamadas de LLM em loop.
// ============================================================================

export interface RateLimitDecision {
  allowed: boolean;
  /** Quanto tempo (ms) ate poder enviar de novo, quando bloqueado. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): RateLimitDecision {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: recent[0]! + this.windowMs - now };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }
}

/** Rate limiter permissivo (default: nao limita). */
export const allowAllRateLimiter: RateLimiter = {
  check: () => ({ allowed: true }),
};
