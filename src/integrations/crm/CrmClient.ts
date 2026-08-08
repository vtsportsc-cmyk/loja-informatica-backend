import { crmEventSchema } from './types.js';
import type { CrmEvent, CrmEventName, CrmSendResult } from './types.js';

// ============================================================================
// CrmClient - cliente HTTP do CRM (trycompai/crm).
// Regras de resiliencia:
//   * timeout rigido (max 3000ms via AbortController);
//   * CRM_ENABLED=false => sendEvent vira no-op silencioso (dev sem chave);
//   * o emissor (`emitCrmEvent`) NUNCA lanca para o chamador: qualquer falha
//     vira apenas um log de aviso, mantendo a FSM e o atendimento intactos.
// ============================================================================

export const CRM_TIMEOUT_MS = 3_000;

export class CrmRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`CRM send event HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'CrmRequestError';
    this.status = status;
    this.body = body;
  }
}

export interface ICrmClient {
  readonly enabled: boolean;
  sendEvent(event: CrmEvent): Promise<CrmSendResult>;
}

export interface CrmClientOptions {
  baseURL: string;
  apiToken: string;
  enabled: boolean;
  /** Timeout de cada chamada (max 3000ms, por design). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CrmClient implements ICrmClient {
  readonly enabled: boolean;
  private readonly baseURL: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CrmClientOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.apiToken = options.apiToken;
    this.enabled = options.enabled;
    this.timeoutMs = Math.min(options.timeoutMs ?? CRM_TIMEOUT_MS, CRM_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendEvent(event: CrmEvent): Promise<CrmSendResult> {
    if (!this.enabled) {
      return { delivered: false, event: event.event, skipped: 'disabled' };
    }
    const payload = crmEventSchema.parse(event);
    const res = await this.request('/events', payload);
    if (!res.ok) {
      throw new CrmRequestError(res.status, await res.text().catch(() => ''));
    }
    return { delivered: true, event: event.event, statusCode: res.status };
  }

  private async request(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseURL}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Emissor NAO-BLOQUEANTE de eventos para o CRM. Nunca rejeita/rethrow:
 * falhas de comunicacao viram apenas console.warn. Retorna a promise apenas
 * para facilitar asserts em testes; em runtime ela e disparada sem await.
 */
export function emitCrmEvent(
  client: ICrmClient | undefined,
  event: CrmEvent,
): Promise<void> {
  if (!client || !client.enabled) return Promise.resolve();
  return client.sendEvent(event).then(
    (result) => {
      if (!result.delivered) {
        console.warn(`[crm] evento ${result.event} nao entregue (${result.skipped ?? 'n/a'})`);
      }
    },
    (err: unknown) => {
      console.warn(`[crm] falha ao enviar ${event.event}: ${(err as Error).message}`);
    },
  );
}

export type { CrmEventName } from './types.js';
