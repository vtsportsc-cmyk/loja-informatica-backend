import {
  LlmAllProvidersFailedError,
  LlmError,
  LlmHttpError,
  LlmNetworkError,
  LlmProviderTimeoutError,
} from './errors.js';
import { OpenAICompatProvider } from './OpenAICompatProvider.js';
import type { LlmChatParams, LlmProviderConfig, LlmResult } from './types.js';

export type ProviderChangeReason =
  | 'timeout'
  | 'rate_limit'
  | 'http_5xx'
  | 'network'
  | 'auth'
  | 'invalid_response'
  | 'recovered';

export interface ProviderChangeEvent {
  from: string;
  to: string;
  reason: ProviderChangeReason;
  status?: number;
  retryAttempt: number;
}

export interface RouterCallResult {
  provider: string;
  model: string;
  ok: boolean;
  elapsedMs: number;
  promptTokens?: number;
  completionTokens?: number;
  errorCode?: LlmError['code'];
  /** true se a chamada foi atendida pelo fallback (failover ativo). */
  failover: boolean;
  /** true se o primario falhou com 429 e houve retry com backoff. */
  retried: boolean;
}

export interface LLMProviderRouterOptions {
  primary: LlmProviderConfig;
  fallback: LlmProviderConfig;
  timeoutMs?: number;
  /** Janela em ms em que o fallback fica ativo apos uma falha (circuit breaker). Default 30s. */
  coolDownMs?: number;
  /** Quantas vezes reintentar o primario em caso de 429 (backoff). Default 1. */
  rateLimitRetries?: number;
  /** Base do backoff exponencial em ms para retries de 429. Default 250ms. */
  backoffBaseMs?: number;
  /** Permite injetar clientes (ex.: mocks em testes). */
  createProvider?: (config: LlmProviderConfig) => Pick<OpenAICompatProvider, 'chat'>;
  onProviderChange?: (event: ProviderChangeEvent) => void;
  /** Hook observabilidade: cada tentativa de chamada concluida (ok ou erro). */
  onResult?: (result: RouterCallResult) => void;
}

// Roteador de provedores de IA com fallback automatico e circuit breaker.
// 1. Tenta o Groq (principal) - respostas rapidas para o SURI.
// 2. Se expirar (timeout 3.5s), retornar 429 (com retry+backoff) / 5xx / erro de
//    rede/auth, migra a chamada para o Google AI Studio / Gemini (contingencia).
// 3. Apos a falha, o fallback fica ativo por `coolDownMs` (30s) sem "flip-flop";
//    depois disso, o primario volta a ser sondado.
export class LLMProviderRouter {
  private readonly primaryConfig: LlmProviderConfig;
  private readonly fallbackConfig: LlmProviderConfig;
  private readonly timeoutMs: number;
  private readonly coolDownMs: number;
  private readonly rateLimitRetries: number;
  private readonly backoffBaseMs: number;
  private readonly onProviderChange?: LLMProviderRouterOptions['onProviderChange'];
  private readonly onResult?: LLMProviderRouterOptions['onResult'];
  private readonly primary: Pick<OpenAICompatProvider, 'chat'>;
  private readonly fallback: Pick<OpenAICompatProvider, 'chat'>;
  private fallbackActive = false;
  private circuitOpenUntil = 0;

  constructor(options: LLMProviderRouterOptions) {
    this.primaryConfig = options.primary;
    this.fallbackConfig = options.fallback;
    this.timeoutMs = options.timeoutMs ?? this.primaryConfig.timeoutMs ?? 3500;
    this.coolDownMs = options.coolDownMs ?? 30000;
    this.rateLimitRetries = options.rateLimitRetries ?? 1;
    this.backoffBaseMs = options.backoffBaseMs ?? 250;
    this.onProviderChange = options.onProviderChange;
    this.onResult = options.onResult;
    this.primary = options.createProvider
      ? options.createProvider(this.primaryConfig)
      : new OpenAICompatProvider(this.primaryConfig);
    this.fallback = options.createProvider
      ? options.createProvider(this.fallbackConfig)
      : new OpenAICompatProvider(this.fallbackConfig);
  }

  get activeProvider(): string {
    return this.fallbackActive ? this.fallbackConfig.name : this.primaryConfig.name;
  }

  get state(): {
    activeProvider: string;
    fallbackActive: boolean;
    circuitOpen: boolean;
    circuitOpenUntil: number;
  } {
    return {
      activeProvider: this.activeProvider,
      fallbackActive: this.fallbackActive,
      circuitOpen: Date.now() < this.circuitOpenUntil,
      circuitOpenUntil: this.circuitOpenUntil,
    };
  }

  async chat(params: LlmChatParams): Promise<LlmResult> {
    const errors: LlmError[] = [];

    // Circuito aberto: nao sondar o primario ate o cooldown expirar.
    if (Date.now() < this.circuitOpenUntil) {
      try {
        const res = await this.callWithTimeout(this.fallback, this.fallbackConfig, params);
        this.emit(this.fallbackConfig, res, performance.now(), true, false);
        return res;
      } catch (err) {
        const mapped = this.normalizeError(err, this.fallbackConfig.name);
        errors.push(mapped);
        this.emitError(this.fallbackConfig, performance.now(), mapped, true, false);
        throw new LlmAllProvidersFailedError(errors);
      }
    }

    try {
      const res = await this.callPrimaryWithRetries(params);
      if (this.fallbackActive) {
        this.fallbackActive = false;
        this.onProviderChange?.({
          from: this.fallbackConfig.name,
          to: this.primaryConfig.name,
          reason: 'recovered',
          retryAttempt: 0,
        });
      }
      return res;
    } catch (primaryErr) {
      const mapped = this.normalizeError(primaryErr, this.primaryConfig.name);
      errors.push(mapped);

      if (!this.shouldFailover(mapped)) {
        this.emitError(this.primaryConfig, performance.now(), mapped, false, false);
        throw mapped;
      }

      this.openCircuitAndActivateFallback(mapped);

      try {
        const res = await this.callWithTimeout(this.fallback, this.fallbackConfig, params);
        this.emit(this.fallbackConfig, res, performance.now(), true, true);
        return res;
      } catch (fallbackErr) {
        const mappedFallback = this.normalizeError(fallbackErr, this.fallbackConfig.name);
        errors.push(mappedFallback);
        this.emitError(this.fallbackConfig, performance.now(), mappedFallback, true, true);
        throw new LlmAllProvidersFailedError(errors);
      }
    }
  }

  /** Tenta o primario, reintentando 429 com backoff exponencial antes do failover. */
  private async callPrimaryWithRetries(params: LlmChatParams): Promise<LlmResult> {
    let attempt = 0;
    let retried = false;
    for (;;) {
      const started = performance.now();
      try {
        const res = await this.callWithTimeout(this.primary, this.primaryConfig, params);
        this.emit(this.primaryConfig, res, started, false, retried);
        return res;
      } catch (err) {
        const mapped = this.normalizeError(err, this.primaryConfig.name);
        if (mapped.code === 'rate_limit' && attempt < this.rateLimitRetries) {
          attempt += 1;
          retried = true;
          this.emitError(this.primaryConfig, started, mapped, false, true);
          const delayMs = this.backoffBaseMs * 2 ** (attempt - 1);
          await sleep(delayMs);
          continue;
        }
        this.emitError(this.primaryConfig, started, mapped, false, retried);
        throw mapped;
      }
    }
  }

  private async callWithTimeout(
    provider: Pick<OpenAICompatProvider, 'chat'>,
    config: LlmProviderConfig,
    params: LlmChatParams,
  ): Promise<LlmResult> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    try {
      return await provider.chat(params, timeoutSignal);
    } catch (err) {
      if (isAbortError(err)) {
        throw new LlmProviderTimeoutError(config.name, this.timeoutMs);
      }
      throw err;
    }
  }

  private shouldFailover(err: LlmError): boolean {
    switch (err.code) {
      case 'timeout':
      case 'rate_limit':
      case 'http':
        return err.status === undefined || err.status >= 500 || err.status === 429;
      case 'network':
      case 'auth':
        return true;
      default:
        return false;
    }
  }

  private openCircuitAndActivateFallback(err: LlmError): void {
    this.circuitOpenUntil = Date.now() + this.coolDownMs;
    this.fallbackActive = true;
    this.onProviderChange?.({
      from: this.primaryConfig.name,
      to: this.fallbackConfig.name,
      reason: err.code as ProviderChangeReason,
      status: err.status,
      retryAttempt: 1,
    });
  }

  private normalizeError(err: unknown, providerName: string): LlmError {
    if (err instanceof LlmError) {
      return err.provider === providerName ? err : err;
    }
    return new LlmNetworkError(providerName, err);
  }

  private emit(
    config: LlmProviderConfig,
    res: LlmResult,
    started: number,
    failover: boolean,
    retried: boolean,
  ): void {
    this.onResult?.({
      provider: config.name,
      model: config.model,
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      promptTokens: res.usage?.promptTokens,
      completionTokens: res.usage?.completionTokens,
      failover,
      retried,
    });
  }

  private emitError(
    config: LlmProviderConfig,
    started: number,
    err: LlmError,
    failover: boolean,
    retried: boolean,
  ): void {
    this.onResult?.({
      provider: config.name,
      model: config.model,
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      errorCode: err.code,
      failover,
      retried,
    });
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
