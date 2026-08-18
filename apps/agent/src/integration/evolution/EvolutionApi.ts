import { agentReplySchema } from '../../types/agent.js';
import type { AgentReply } from '../../types/agent.js';

// ============================================================================
// Evolution API - envio de mensagens do WhatsApp (substitui a plataforma SURI).
// Referencia (v2): https://doc.evolution-api.com/v2/api-reference/message/send-text
//   POST {base}/message/sendText/{instance}   body: { number, textMessage: { text } }
//   POST {base}/message/sendMedia/{instance}  body: { number, mediatype, media, caption, fileName }
// Autenticacao via header `apikey` (chave global ou da instancia).
// ============================================================================

export interface EvolutionApiOptions {
  baseURL: string;
  instance: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface EvolutionMedia {
  type: 'image' | 'document' | 'audio' | 'video';
  /** URL publica da midia (ou base64 com prefixo data:). */
  url: string;
  caption?: string;
  fileName?: string;
}

export interface EvolutionConnectionState {
  connected: boolean;
  state: string;
  error?: string;
}

export class EvolutionApi {
  private readonly baseURL: string;
  private readonly instance: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EvolutionApiOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.instance = options.instance;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendText(to: string, text: string): Promise<void> {
    const res = await this.request(`/message/sendText/${encodeURIComponent(this.instance)}`, {
      number: normalizeNumber(to),
      textMessage: { text },
    });
    if (!res.ok) throw new Error(`Evolution sendText HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  async sendMedia(to: string, media: EvolutionMedia): Promise<void> {
    const res = await this.request(`/message/sendMedia/${encodeURIComponent(this.instance)}`, {
      number: normalizeNumber(to),
      mediatype: media.type,
      media: media.url,
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.fileName ? { fileName: media.fileName } : {}),
    });
    if (!res.ok) throw new Error(`Evolution sendMedia HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  /**
   * Consulta o estado de conexao da instancia no WhatsApp (monitoramento).
   * Endpoint: GET /instance/connectionState/{instance}. `open` = conectado.
   */
  async getConnectionState(): Promise<EvolutionConnectionState> {
    try {
      const res = await this.fetchImpl(
        `${this.baseURL}/instance/connectionState/${encodeURIComponent(this.instance)}`,
        { method: 'GET', headers: { apikey: this.apiKey }, signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (!res.ok) {
        return { connected: false, state: 'error', error: `HTTP ${res.status}` };
      }
      const body = (await res.json().catch(() => ({}))) as {
        instance?: { state?: string };
      };
      const state = body.instance?.state ?? 'unknown';
      return { connected: state === 'open', state };
    } catch (err) {
      return { connected: false, state: 'error', error: (err as Error).message };
    }
  }

  /** Compat com o antigo contrato de reply do motor (AgentReply -> Evolution). */
  async sendReply(reply: AgentReply): Promise<void> {
    const parsed = agentReplySchema.parse(reply);
    if (parsed.attachmentUrl && parsed.type !== 'text') {
      await this.sendMedia(parsed.ticketId, {
        type: mediaTypeFor(parsed.type),
        url: parsed.attachmentUrl,
        caption: parsed.text,
        fileName: parsed.type === 'document' ? parsed.text : undefined,
      });
      return;
    }
    await this.sendText(parsed.ticketId, parsed.text);
  }

  /**
   * Baixa a midia de uma mensagem recebida como base64 (usado para transcrever
   * audio). Endpoint: POST /chat/getBase64FromMediaMessage/{instance} com o
   * `key.id` da mensagem (ver doc Evolution API v2). Retorna o base64 puro.
   */
  async getBase64FromMediaMessage(messageId: string): Promise<string> {
    if (!messageId) throw new Error('messageId ausente para baixar midia');
    const res = await this.request(`/chat/getBase64FromMediaMessage/${encodeURIComponent(this.instance)}`, {
      message: { key: { id: messageId } },
      convertToMp4: false,
    });
    if (!res.ok) {
      throw new Error(`Evolution getBase64FromMediaMessage HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json().catch(() => ({}))) as { base64?: unknown };
    if (typeof body.base64 !== 'string' || body.base64.length === 0) {
      throw new Error('Evolution retornou base64 vazio para a midia');
    }
    return body.base64;
  }

  private async request(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}

/** JID (5511999990000@s.whatsapp.net) -> numero puro; remove + e espacos. */
function normalizeNumber(to: string): string {
  return to.replace(/@s\.whatsapp\.net$/i, '').replace(/[^\d]/g, '');
}

function mediaTypeFor(type: AgentReply['type']): EvolutionMedia['type'] {
  switch (type) {
    case 'image':
      return 'image';
    case 'document':
      return 'document';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    default:
      return 'image';
  }
}
