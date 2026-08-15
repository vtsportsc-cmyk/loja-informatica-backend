import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IMessageRepository } from '../prisma/MessageRepository.js';
import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import { normalizeMessage } from './evolution.js';

// ============================================================================
// Automacao de captura de leads pelo Instagram (estilo ManyChat).
//
// Rota: POST /api/webhooks/instagram.
//   - Quando um lead comenta em um post palavras-chave (ex.: "PC", "MONTAR",
//     "QUERO"), o agente responde automaticamente no Direct com o link do
//     "Monte seu PC" (?utm_source=instagram_comment) e cria o lead no Kanban
//     do CRM com a origem INSTAGRAM.
//
// Formatos aceitos:
//   - Evolution API (instancia Instagram): event messages.upsert com
//     data.key.remoteJid terminando em @instagram.
//   - Meta Graph API: object "instagram" com entry[].changes[] de campo
//     "comments" (comentario em post) ou "messages" (Direct).
// Referencia Meta: https://developers.facebook.com/docs/graph-api/webhooks
// ============================================================================

export interface InstagramWebhookDeps {
  repository: IMessageRepository;
  /** Cliente Evolution da instancia do Instagram (ex.: instancia "loja-ig"). */
  evolution: EvolutionApi;
  /** URL base do "Monte seu PC" (sem query), ex.: https://loja.com.br/builder. */
  builderUrl: string;
  /** Segredo para validar x-hub-signature-256 (Meta) / x-signature (Evolution). */
  webhookSecret?: string;
  /** Palavras-chave que disparam o Direct (default: PC, MONTAR, QUERO, ...). */
  keywords?: string[];
  logger?: (message: string) => void;
}

export interface InstagramWebhookResult {
  ok: boolean;
  handled?: boolean;
  skipped?: string;
  error?: string;
}

const DEFAULT_KEYWORDS = ['pc', 'montar', 'quero', 'orcamento', 'valor', 'preco'];

/** UTM atribuido aos leads capturados por comentario no Instagram. */
const INSTAGRAM_COMMENT_UTM = 'instagram_comment';

interface InstagramEvent {
  senderId: string;
  senderName: string | null;
  text: string;
  origin: 'comment' | 'direct';
}

export class InstagramWebhookHandler {
  private readonly repository: IMessageRepository;
  private readonly evolution: EvolutionApi;
  private readonly builderUrl: string;
  private readonly webhookSecret?: string;
  private readonly keywords: string[];
  private readonly logger: (message: string) => void;

  constructor(deps: InstagramWebhookDeps) {
    this.repository = deps.repository;
    this.evolution = deps.evolution;
    this.builderUrl = deps.builderUrl.replace(/\/$/, '');
    this.webhookSecret = deps.webhookSecret;
    this.keywords = (deps.keywords?.length ? deps.keywords : DEFAULT_KEYWORDS).map(normalizeText);
    this.logger = deps.logger ?? ((m) => console.log(`[instagram] ${m}`));
  }

  /** Corpo do Direct enviado ao lead (link do Monte seu PC com UTM de comentario). */
  private buildDirectReply(): string {
    const link = `${this.builderUrl}?utm_source=${INSTAGRAM_COMMENT_UTM}&utm_medium=instagram&utm_campaign=${INSTAGRAM_COMMENT_UTM}`;
    return (
      `Olá! Vi seu comentário e preparei o caminho mais rápido: monte seu PC ideal por aqui.\n\n` +
      `${link}\n\n` +
      `Escolha as peças e gere o orçamento na hora — sem compromisso.`
    );
  }

  async handle(rawBody: string, signature?: string): Promise<InstagramWebhookResult> {
    try {
      if (this.webhookSecret && !this.verifySignature(rawBody, signature)) {
        return { ok: false, error: 'assinatura invalida' };
      }

      const payload = JSON.parse(rawBody) as unknown;
      const events = extractEvents(payload);
      if (events.length === 0) {
        return { ok: true, handled: false, skipped: 'no_instagram_event' };
      }

      let handledAny = false;
      let skippedAny = false;
      for (const event of events) {
        const matched = this.keywords.some((kw) => normalizeText(event.text).includes(kw));
        if (!matched) {
          this.logger(`[${event.senderId}] comentario sem palavra-chave; sem resposta automatica.`);
          skippedAny = true;
          continue;
        }

        await this.processLead(event);
        handledAny = true;
      }

      if (handledAny) return { ok: true, handled: true };
      return { ok: true, handled: false, skipped: skippedAny ? 'no_keyword' : 'unknown' };
    } catch (err) {
      this.logger(`falha ao processar webhook do instagram: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Converte o comentario/Direct em lead no Kanban (origem INSTAGRAM) e envia
   * o Direct com o link do Monte seu PC. Falha de envio nunca derruba o
   * webhook: o lead ja esta persistido e o erro e apenas registrado.
   */
  private async processLead(event: InstagramEvent): Promise<void> {
    const whatsappId = `${event.senderId}@instagram`;
    const conversation = await this.repository.ensureConversation(whatsappId, event.senderName ?? 'Lead Instagram', {
      channel: 'instagram',
    });

    await this.repository.saveInboundMessage(conversation.id, {
      type: 'text',
      text: event.text,
      whatsappId: `${event.senderId}@instagram`,
    });
    await this.repository.touchConversation(conversation.id, {
      at: new Date().toISOString(),
      unreadDelta: 1,
    });

    const reply = this.buildDirectReply();
    try {
      await this.evolution.sendText(event.senderId, reply);
      await this.repository.saveOutboundMessage(conversation.id, {
        type: 'text',
        text: reply,
        status: 'sent',
      });
      await this.repository.touchConversation(conversation.id, {
        at: new Date().toISOString(),
        unreadDelta: 0,
      });
      this.logger(`[${event.senderId}] lead INSTAGRAM criado e Direct enviado (${event.origin}).`);
    } catch (err) {
      this.logger(
        `[${event.senderId}] lead INSTAGRAM criado, mas falha ao enviar Direct: ${(err as Error).message}`,
      );
    }

    await this.repository.addNote(conversation.id, {
      text: `Comentário no Instagram (${event.origin}): ${truncate(event.text, 160)}`,
    });
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
// Parsing dos payloads (Evolution API e Meta Graph API)
// ----------------------------------------------------------------------------

/** Normaliza texto para matching de palavras-chave (minusculas e sem acentos). */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Detecta se o texto contem alguma das palavras-chave de captura (PC/MONTAR/QUERO). */
export function matchesInstagramKeywords(text: string | undefined | null, keywords: string[]): boolean {
  if (!text) return false;
  const normalized = normalizeText(text);
  return keywords.some((kw) => normalized.includes(kw));
}

function extractEvents(payload: unknown): InstagramEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;

  // --- Formato Evolution API (instancia Instagram) ---
  if (root['event'] === 'messages.upsert') {
    const event = parseEvolutionMessage(root);
    return event ? [event] : [];
  }

  // --- Formato Meta Graph API (object: "instagram") ---
  if (root['object'] === 'instagram' && Array.isArray(root['entry'])) {
    const events: InstagramEvent[] = [];
    for (const entry of root['entry'] as unknown[]) {
      const changes = (entry as Record<string, unknown>)?.['changes'];
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        const parsed = parseMetaChange(change);
        if (parsed) events.push(parsed);
      }
    }
    return events;
  }

  return [];
}

function parseEvolutionMessage(payload: Record<string, unknown>): InstagramEvent | null {
  const data = payload['data'] as Record<string, unknown> | undefined;
  const key = data?.['key'] as Record<string, unknown> | undefined;
  const remoteJid = typeof key?.['remoteJid'] === 'string' ? key['remoteJid'] : '';
  if (!remoteJid.toLowerCase().endsWith('@instagram')) return null;
  if (key?.['fromMe']) return null;

  const senderId = remoteJid.replace(/@instagram$/i, '');
  const message = data?.['message'] as Record<string, unknown> | undefined;
  const parsed = normalizeMessage(message);
  return {
    senderId,
    senderName: typeof data?.['pushName'] === 'string' ? data['pushName'] : null,
    text: parsed.text ?? '[mensagem vazia]',
    origin: 'direct',
  };
}

function parseMetaChange(change: unknown): InstagramEvent | null {
  const changeObj = change as Record<string, unknown> | undefined;
  const field = changeObj?.['field'];
  if (field !== 'comments' && field !== 'messages') return null;

  const value = changeObj?.['value'] as Record<string, unknown> | undefined;
  const from = value?.['from'] as Record<string, unknown> | undefined;
  const senderId = typeof from?.['id'] === 'string' ? from['id'] : undefined;
  if (!senderId) return null;

  const directMessage = value?.['message'] as Record<string, unknown> | undefined;
  const rawText =
    typeof value?.['text'] === 'string'
      ? (value['text'] as string)
      : typeof directMessage?.['text'] === 'string'
        ? (directMessage['text'] as string)
        : '';

  return {
    senderId,
    senderName: typeof from?.['username'] === 'string' ? from['username'] : null,
    text: rawText,
    origin: field === 'comments' ? 'comment' : 'direct',
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
