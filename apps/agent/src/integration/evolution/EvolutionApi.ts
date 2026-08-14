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
  fetchImpl?: typeof fetch;
}

export interface EvolutionMedia {
  type: 'image' | 'document' | 'audio' | 'video';
  /** URL publica da midia (ou base64 com prefixo data:). */
  url: string;
  caption?: string;
  fileName?: string;
}

export class EvolutionApi {
  private readonly baseURL: string;
  private readonly instance: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EvolutionApiOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.instance = options.instance;
    this.apiKey = options.apiKey;
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

  private async request(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify(body),
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
