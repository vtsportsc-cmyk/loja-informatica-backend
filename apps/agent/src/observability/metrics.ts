import type { LlmError } from '../llm/errors.js';
import type { ProviderChangeEvent } from '../llm/LLMProviderRouter.js';
import type { BotStateId } from '../fsm/states.js';

// ============================================================================
// Observabilidade: contadores acumulados em memoria com snapshot e saída
// Prometheus text format para o endpoint GET /metrics.
// ============================================================================

export interface LlmCallMetric {
  provider: string;
  model: string;
  ok: boolean;
  elapsedMs: number;
  promptTokens?: number;
  completionTokens?: number;
  errorCode?: LlmError['code'];
  failover: boolean;
  retried: boolean;
}

interface LlmAccumulator {
  calls: number;
  errors: number;
  failovers: number;
  retried: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

interface MetricsSnapshot {
  llm: Array<{ provider: string; model: string } & LlmAccumulator>;
  failoversByReason: Record<string, number>;
  recoveries: number;
  transitions: Record<string, number>;
  terminalOutcomes: Record<string, number>;
  webhooks: Record<string, number>;
  rateLimited: Record<string, number>;
  totalRateLimited: number;
  /** Respostas institucionais servidas sem LLM (cache de FAQs). */
  institutionalAnswers: { matched: number; cacheHits: number };
}

export class Metrics {
  private readonly llm = new Map<string, LlmAccumulator>();
  private readonly failoversByReason = new Map<string, number>();
  private recoveries = 0;
  private readonly transitions = new Map<string, number>();
  private readonly terminalOutcomes = new Map<string, number>();
  private readonly webhooks = new Map<string, number>();
  private readonly rateLimited = new Map<string, number>();
  private institutionalMatched = 0;
  private institutionalCacheHits = 0;

  /** Resposta institucional servida sem chamada de LLM (cache de FAQ). */
  recordInstitutionalAnswer(cached: boolean): void {
    this.institutionalMatched += 1;
    if (cached) this.institutionalCacheHits += 1;
  }

  recordLlmCall(metric: LlmCallMetric): void {
    const key = `${metric.provider}|${metric.model}`;
    const acc = this.llm.get(key) ?? {
      calls: 0,
      errors: 0,
      failovers: 0,
      retried: 0,
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
    };
    acc.calls += 1;
    acc.latencyMs += metric.elapsedMs;
    acc.promptTokens += metric.promptTokens ?? 0;
    acc.completionTokens += metric.completionTokens ?? 0;
    if (!metric.ok) acc.errors += 1;
    if (metric.failover) acc.failovers += 1;
    if (metric.retried) acc.retried += 1;
    this.llm.set(key, acc);
  }

  recordProviderChange(event: ProviderChangeEvent): void {
    if (event.reason === 'recovered') {
      this.recoveries += 1;
      return;
    }
    this.failoversByReason.set(
      event.reason,
      (this.failoversByReason.get(event.reason) ?? 0) + 1,
    );
  }

  recordTransition(from: BotStateId, to: BotStateId): void {
    const key = `${from}->${to}`;
    this.transitions.set(key, (this.transitions.get(key) ?? 0) + 1);
  }

  recordTerminalOutcome(state: BotStateId): void {
    this.terminalOutcomes.set(state, (this.terminalOutcomes.get(state) ?? 0) + 1);
  }

  recordWebhook(event: string, ok: boolean): void {
    const key = `${event}:${ok ? 'ok' : 'error'}`;
    this.webhooks.set(key, (this.webhooks.get(key) ?? 0) + 1);
  }

  recordRateLimited(key: string): void {
    this.rateLimited.set(key, (this.rateLimited.get(key) ?? 0) + 1);
  }

  snapshot(): MetricsSnapshot {
    const llm: MetricsSnapshot['llm'] = [];
    for (const [key, acc] of this.llm) {
      const [provider, model] = key.split('|');
      llm.push({ provider: provider ?? '', model: model ?? '', ...acc });
    }
    return {
      llm,
      failoversByReason: Object.fromEntries(this.failoversByReason),
      recoveries: this.recoveries,
      transitions: Object.fromEntries(this.transitions),
      terminalOutcomes: Object.fromEntries(this.terminalOutcomes),
      webhooks: Object.fromEntries(this.webhooks),
      rateLimited: Object.fromEntries(this.rateLimited),
      totalRateLimited: [...this.rateLimited.values()].reduce((a, b) => a + b, 0),
      institutionalAnswers: {
        matched: this.institutionalMatched,
        cacheHits: this.institutionalCacheHits,
      },
    };
  }

  toPrometheus(): string {
    const s = this.snapshot();
    const lines: string[] = ['# HELP llm_calls_total Chamadas ao provedor de LLM.', '# TYPE llm_calls_total counter'];
    for (const entry of s.llm) {
      lines.push(`llm_calls_total{provider="${entry.provider}",model="${entry.model}"} ${entry.calls}`);
      lines.push(`llm_errors_total{provider="${entry.provider}",model="${entry.model}"} ${entry.errors}`);
      lines.push(`llm_failovers_total{provider="${entry.provider}",model="${entry.model}"} ${entry.failovers}`);
      lines.push(`llm_retried_total{provider="${entry.provider}",model="${entry.model}"} ${entry.retried}`);
      lines.push(`llm_latency_ms_total{provider="${entry.provider}",model="${entry.model}"} ${entry.latencyMs}`);
      lines.push(`llm_prompt_tokens_total{provider="${entry.provider}",model="${entry.model}"} ${entry.promptTokens}`);
      lines.push(`llm_completion_tokens_total{provider="${entry.provider}",model="${entry.model}"} ${entry.completionTokens}`);
    }
    lines.push('# HELP llm_failover_reasons_total Falhas que ativaram o fallback.', '# TYPE llm_failover_reasons_total counter');
    for (const [reason, n] of Object.entries(s.failoversByReason)) {
      lines.push(`llm_failover_reasons_total{reason="${reason}"} ${n}`);
    }
    lines.push('# TYPE llm_recoveries_total counter');
    lines.push(`llm_recoveries_total ${s.recoveries}`);
    lines.push('# HELP fsm_transitions_total Transicoes de estado do atendimento.', '# TYPE fsm_transitions_total counter');
    for (const [key, n] of Object.entries(s.transitions)) {
      lines.push(`fsm_transitions_total{transition="${key}"} ${n}`);
    }
    lines.push('# TYPE fsm_terminal_outcomes_total counter');
    for (const [state, n] of Object.entries(s.terminalOutcomes)) {
      lines.push(`fsm_terminal_outcomes_total{state="${state}"} ${n}`);
    }
    lines.push('# TYPE payment_webhooks_total counter');
    for (const [event, n] of Object.entries(s.webhooks)) {
      lines.push(`payment_webhooks_total{event="${event}"} ${n}`);
    }
    lines.push('# TYPE rate_limited_total counter');
    lines.push(`rate_limited_total ${s.totalRateLimited}`);
    lines.push('# HELP institutional_answers_total Respostas institucionais servidas sem LLM (cache de FAQ).', '# TYPE institutional_answers_total counter');
    lines.push(`institutional_answers_total{result="matched"} ${s.institutionalAnswers.matched}`);
    lines.push(`institutional_answers_total{result="cache_hit"} ${s.institutionalAnswers.cacheHits}`);
    return lines.join('\n') + '\n';
  }
}
