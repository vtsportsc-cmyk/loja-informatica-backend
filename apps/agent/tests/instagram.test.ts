import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMessageRepository } from '../src/prisma/MessageRepository.js';
import type { EvolutionApi } from '../src/integration/evolution/EvolutionApi.js';
import {
  InstagramWebhookHandler,
  matchesInstagramKeywords,
  normalizeText,
} from '../src/webhooks/instagram.js';

const BUILDER_URL = 'https://loja.com.br/builder';

function evolutionPayload(text: string, jid = '17841400000000001@instagram', pushName = 'Joao da Silva'): string {
  return JSON.stringify({
    event: 'messages.upsert',
    instance: 'loja-ig',
    data: {
      key: { remoteJid: jid, fromMe: false, id: 'IG-1' },
      message: { conversation: text },
      messageType: 'conversation',
      pushName,
    },
  });
}

function metaCommentPayload(text: string, userId = '17841400000000002', username = 'lead_ig'): string {
  return JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'entry-1',
        time: 1_600_000_000,
        changes: [
          {
            field: 'comments',
            value: {
              id: 'comment-1',
              text,
              from: { id: userId, username },
              media: { id: 'media-1', media_type: 'IMAGE' },
            },
          },
        ],
      },
    ],
  });
}

interface FakeEvolution {
  calls: Array<{ to: string; text: string }>;
  client: EvolutionApi;
}

function makeFakeEvolution(): FakeEvolution {
  const calls: Array<{ to: string; text: string }> = [];
  const client = {
    sendText: async (to: string, text: string): Promise<void> => {
      calls.push({ to, text });
    },
  } as unknown as EvolutionApi;
  return { calls, client };
}

function makeHandler(evolution: FakeEvolution, secret?: string) {
  const repository = new InMemoryMessageRepository();
  const handler = new InstagramWebhookHandler({
    repository,
    evolution: evolution.client,
    builderUrl: BUILDER_URL,
    webhookSecret: secret,
  });
  return { repository, handler };
}

describe('InstagramWebhookHandler - captura de leads por comentario', () => {
  let evolution: FakeEvolution;

  beforeEach(() => {
    evolution = makeFakeEvolution();
  });

  it('comentario com palavra-chave cria lead INSTAGRAM e envia Direct com o link + UTM', async () => {
    const { repository, handler } = makeHandler(evolution);
    const result = await handler.handle(evolutionPayload('quero montar um pc gamer'));

    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);

    expect(evolution.calls).toHaveLength(1);
    const sent = evolution.calls[0]!;
    expect(sent.to).toBe('17841400000000001');
    expect(sent.text).toContain(BUILDER_URL);
    expect(sent.text).toContain('utm_source=instagram_comment');
    expect(sent.text).toContain('utm_medium=instagram');

    const conv = await repository.getConversationByWhatsapp('17841400000000001');
    expect(conv).not.toBeNull();
    expect(conv?.leadSource).toBe('INSTAGRAM');
    expect(conv?.customerName).toBe('Joao da Silva');

    const messages = await repository.listMessages(conv!.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ direction: 'inbound', text: 'quero montar um pc gamer' });
    expect(messages[1]).toMatchObject({ direction: 'outbound' });

    const notes = await repository.listNotes(conv!.id);
    expect(notes.some((n) => n.text.includes('Comentário no Instagram'))).toBe(true);
  });

  it('payload da Meta Graph API (object instagram / field comments) tambem e processado', async () => {
    const { repository, handler } = makeHandler(evolution);
    const result = await handler.handle(metaCommentPayload('PC bom pra edição?'));

    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);
    expect(evolution.calls).toHaveLength(1);
    expect(evolution.calls[0]!.to).toBe('17841400000000002');

    const conv = await repository.getConversationByWhatsapp('17841400000000002');
    expect(conv?.leadSource).toBe('INSTAGRAM');
    expect(conv?.customerName).toBe('lead_ig');
  });

  it('comentario sem palavra-chave e ignorado (sem lead nem Direct)', async () => {
    const { repository, handler } = makeHandler(evolution);
    const result = await handler.handle(evolutionPayload('que foto linda!'));

    expect(result.ok).toBe(true);
    expect(result.handled).toBe(false);
    expect(result.skipped).toBe('no_keyword');
    expect(evolution.calls).toHaveLength(0);
    expect(await repository.getConversationByWhatsapp('17841400000000001')).toBeNull();
  });

  it('assinatura invalida rejeita o webhook com erro', async () => {
    const { handler } = makeHandler(evolution, 'segredo');
    const raw = evolutionPayload('quero montar pc');
    const result = await handler.handle(raw, 'sha256=assinatura-errada');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('assinatura invalida');
    expect(evolution.calls).toHaveLength(0);
  });

  it('assinatura valida (HMAC sha256) e aceita', async () => {
    const { createHmac } = await import('node:crypto');
    const secret = 'segredo';
    const { handler } = makeHandler(evolution, secret);
    const raw = evolutionPayload('quero montar pc');
    const signature = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const result = await handler.handle(raw, signature);
    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);
  });

  it('mensagens do WhatsApp (@s.whatsapp.net) nao sao processadas pelo webhook do Instagram', async () => {
    const { handler } = makeHandler(evolution);
    const result = await handler.handle(
      evolutionPayload('quero montar pc', '5511999990000@s.whatsapp.net', 'Cliente'),
    );
    expect(result.ok).toBe(true);
    expect(result.handled).toBe(false);
    expect(result.skipped).toBe('no_instagram_event');
    expect(evolution.calls).toHaveLength(0);
  });

  it('matchesInstagramKeywords normaliza acentos e maiusculas', () => {
    expect(matchesInstagramKeywords('QUERO MONTAR UM PC', ['pc', 'montar', 'quero'])).toBe(true);
    expect(matchesInstagramKeywords('quero montar um pc', ['pc', 'montar', 'quero'])).toBe(true);
    expect(matchesInstagramKeywords('VALOR', ['orcamento'])).toBe(false);
    expect(normalizeText('ORÇAMENTO')).toBe('orcamento');
  });
});
