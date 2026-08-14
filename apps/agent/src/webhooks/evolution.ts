import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MessageHandler } from '../agent/MessageHandler.js';
import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import type { AgentInbound } from '../types/agent.js';
import type { IMessageRepository } from '../prisma/MessageRepository.js';

// ============================================================================
// Webhook da Evolution API (WhatsApp).
// Recebe os eventos MESSAGES_UPSERT em tempo real, persiste a conversa e a
// mensagem no PostgreSQL (via IMessageRepository) e aciona o MessageHandler
// (IA + FSM) para gerar a resposta automatica - exceto quando um vendedor
// assumiu o atendimento (humanMode), pausando a IA para aquele cliente.
// Referencia do payload: https://doc.evolution-api.com/v2/api-reference/webhooks
// ============================================================================

export interface EvolutionWebhookDeps {
  repository: IMessageRepository;
  messageHandler: MessageHandler;
  evolution: EvolutionApi;
  webhookSecret?: string;
  logger?: (message: string) => void;
}

export interface EvolutionWebhookResult {
  ok: boolean;
  handled?: boolean;
  skipped?: string;
  error?: string;
}

interface EvolutionPayload {
  event: string;
  instance?: string;
  data?: {
    key?: {
      remoteJid?: string;
      fromMe?: boolean;
      id?: string;
      participant?: string;
    };
    message?: Record<string, unknown>;
    messageType?: string;
    pushName?: string;
    messageTimestamp?: number | string;
  };
  destination?: string;
}

export class EvolutionWebhookHandler {
  private readonly repository: IMessageRepository;
  private readonly messageHandler: MessageHandler;
  private readonly evolution: EvolutionApi;
  private readonly webhookSecret?: string;
  private readonly logger: (message: string) => void;

  constructor(deps: EvolutionWebhookDeps) {
    this.repository = deps.repository;
    this.messageHandler = deps.messageHandler;
    this.evolution = deps.evolution;
    this.webhookSecret = deps.webhookSecret;
    this.logger = deps.logger ?? ((m) => console.log(`[evolution] ${m}`));
  }

  async handle(rawBody: string, signature?: string): Promise<EvolutionWebhookResult> {
    try {
      if (this.webhookSecret && !this.verifySignature(rawBody, signature)) {
        return { ok: false, error: 'assinatura invalida' };
      }

      const payload = JSON.parse(rawBody) as EvolutionPayload;

      if (payload.event !== 'messages.upsert') {
        return { ok: true, skipped: payload.event ?? 'unknown_event' };
      }

      const key = payload.data?.key;
      const remoteJid = key?.remoteJid ?? '';

      if (!remoteJid || key?.fromMe) {
        return { ok: true, skipped: 'from_me' };
      }
      if (!key) {
        return { ok: true, skipped: 'no_key' };
      }
      if (remoteJid.endsWith('@g.us')) {
        return { ok: true, skipped: 'group' };
      }
      if (remoteJid.endsWith('@broadcast')) {
        return { ok: true, skipped: 'broadcast' };
      }

      const phone = remoteJid.replace(/@s\.whatsapp\.net$/i, '');
      const name = payload.data?.pushName || null;

      const conversation = await this.repository.ensureConversation(phone, name);
      const parsed = normalizeMessage(payload.data?.message);

      await this.repository.saveInboundMessage(conversation.id, {
        type: parsed.type,
        text: parsed.text,
        caption: parsed.caption,
        mediaUrl: parsed.mediaUrl,
        mediaMimeType: parsed.mediaMimeType,
        whatsappId: key.id,
      });
      await this.repository.touchConversation(conversation.id, {
        at: new Date().toISOString(),
        unreadDelta: 1,
      });

      const quoteCode = findQuoteCode(parsed.text);
      if (quoteCode) {
        const flagged = await this.repository.markHighValueOpportunity(conversation.id, quoteCode);
        if (flagged.flagged) {
          this.logger(
            `[${phone}] orcamento ${quoteCode} detectado na mensagem; ` +
              `oportunidade de alto valor${flagged.linked ? ' (vinculado ao pedido)' : ' (sem vinculo)'}.`,
          );
        }
      }

      if (conversation.humanMode) {
        this.logger(`[${phone}] atendimento assumido por humano; IA pausada.`);
        return { ok: true, handled: false, skipped: 'human_mode' };
      }

      const inbound = toAgentInbound(phone, name, key.id, parsed);
      const response = await this.messageHandler.processInbound(inbound);
      const reply = response.reply;

      await this.evolution.sendReply(reply);
      await this.repository.saveOutboundMessage(conversation.id, {
        type: 'text',
        text: reply.text,
        status: 'sent',
      });
      await this.repository.touchConversation(conversation.id, {
        at: new Date().toISOString(),
        unreadDelta: 0,
      });

      return { ok: true, handled: true };
    } catch (err) {
      this.logger(`falha ao processar webhook: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  private verifySignature(rawBody: string, signature?: string): boolean {
    if (!this.webhookSecret || !signature) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const received = signature.replace(/^sha256=/i, '');
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

// ----------------------------------------------------------------------------
// Normalizacao da mensagem da Evolution para o contrato interno do motor.
// ----------------------------------------------------------------------------

export interface NormalizedMessage {
  type: string;
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
}

const QUOTE_CODE_RE = /\bQ-[A-Z2-9]{6}\b/i;

/** Detecta um codigo de orcamento do "Monte seu PC" (ex.: Q-AB2CDE) no texto. */
export function findQuoteCode(text: string | undefined | null): string | null {
  if (!text) return null;
  const match = text.match(QUOTE_CODE_RE);
  return match ? match[0].toUpperCase() : null;
}

export function normalizeMessage(message?: Record<string, unknown>): NormalizedMessage {
  if (!message) return { type: 'text', text: '[mensagem vazia]' };

  const text = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;

  if (typeof message.conversation === 'string') {
    return { type: 'text', text: message.conversation };
  }
  if (typeof message.extendedTextMessage === 'object' && message.extendedTextMessage) {
    const ext = message.extendedTextMessage as Record<string, unknown>;
    return { type: 'text', text: text(ext.text) ?? '[mensagem de texto]' };
  }
  if (typeof message.imageMessage === 'object' && message.imageMessage) {
    const img = message.imageMessage as Record<string, unknown>;
    return {
      type: 'image',
      caption: text(img.caption),
      mediaUrl: text(img.url) ?? text(img.base64Encoded) ?? undefined,
      mediaMimeType: text(img.mimetype),
      text: text(img.caption) ?? '[imagem recebida]',
    };
  }
  if (typeof message.audioMessage === 'object' && message.audioMessage) {
    const audio = message.audioMessage as Record<string, unknown>;
    return {
      type: 'audio',
      mediaUrl: text(audio.url),
      mediaMimeType: text(audio.mimetype),
      text: '[áudio recebido]',
    };
  }
  if (typeof message.documentMessage === 'object' && message.documentMessage) {
    const doc = message.documentMessage as Record<string, unknown>;
    return {
      type: 'document',
      caption: text(doc.caption),
      mediaUrl: text(doc.url),
      mediaMimeType: text(doc.mimetype),
      text: text(doc.caption) ?? '[documento recebido]',
    };
  }
  if (typeof message.videoMessage === 'object' && message.videoMessage) {
    const video = message.videoMessage as Record<string, unknown>;
    return {
      type: 'video',
      caption: text(video.caption),
      mediaUrl: text(video.url),
      mediaMimeType: text(video.mimetype),
      text: text(video.caption) ?? '[vídeo recebido]',
    };
  }
  if (typeof message.stickerMessage === 'object' && message.stickerMessage) {
    const sticker = message.stickerMessage as Record<string, unknown>;
    return { type: 'sticker', mediaUrl: text(sticker.url), text: '[figurinha recebida]' };
  }
  if (typeof message.buttonsResponseMessage === 'object' && message.buttonsResponseMessage) {
    const btn = message.buttonsResponseMessage as Record<string, unknown>;
    return { type: 'button', text: text(btn.selectedDisplayText) ?? '[resposta de botão]' };
  }
  if (typeof message.listResponseMessage === 'object' && message.listResponseMessage) {
    const list = message.listResponseMessage as Record<string, unknown>;
    return { type: 'list_reply', text: text(list.title) ?? '[resposta de lista]' };
  }
  return { type: 'text', text: '[tipo de mensagem não suportada]' };
}

function toAgentInbound(
  phone: string,
  name: string | null,
  messageId: string | undefined,
  parsed: NormalizedMessage,
): AgentInbound {
  const now = new Date().toISOString();
  return {
    event: 'message',
    channel: 'whatsapp',
    ticketId: phone,
    customer: { id: phone, phone, name: name ?? undefined },
    message: {
      id: messageId ?? `msg-${Date.now()}`,
      type: parsed.type as AgentInbound['message']['type'],
      text: parsed.text,
      caption: parsed.caption,
      mediaUrl: parsed.mediaUrl,
      mediaMimeType: parsed.mediaMimeType,
      timestamp: now,
    },
    receivedAt: now,
  };
}
