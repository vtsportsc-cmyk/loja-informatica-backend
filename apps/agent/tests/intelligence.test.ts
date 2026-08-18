import { describe, it, expect } from 'vitest';
import { InMemoryMessageRepository } from '../src/prisma/MessageRepository.js';
import { PanelApi } from '../src/panel/PanelApi.js';
import { createQuoteFollowUpJob, buildFollowUpMessage } from '../src/agent/quoteFollowUpJob.js';
import type { EvolutionApi } from '../src/integration/evolution/EvolutionApi.js';

// ============================================================================
// Modulo de Inteligencia de Vendas:
//   * Origem do lead (LeadSource) e motivo de perda (LostReason / CANCELADO);
//   * Timeline unificada de atividades por conversa;
//   * Job de follow-up de orcamentos inativos (ALTA_VALOR).
// ============================================================================

function buildPanel(repository: InMemoryMessageRepository) {
  const sent: Array<{ to: string; text: string }> = [];
  const evolution = {
    sendText: async (to: string, text: string) => {
      sent.push({ to, text });
    },
  } as unknown as EvolutionApi;
  const panel = new PanelApi({ repository, evolution, bling: {} as never, apiKey: 'k' });
  return { panel, sent };
}

const QUOTE = {
  id: 'quote-intel-1',
  code: 'Q-INTEL1',
  totalCents: 500000,
  pixTotalCents: 475000,
  customer: { name: 'Maria Compradora', phone: '5511999991001' },
  items: [
    { sku: 'CPU-8600G', name: 'AMD Ryzen 5 8600G', unitPriceCents: 119990, quantity: 1 },
    { sku: 'MB-B650M', name: 'Gigabyte B650M Gaming WiFi', unitPriceCents: 149990, quantity: 1 },
  ],
};

describe('Origem do lead', () => {
  it('conversa criada via WhatsApp assume WHATSAPP_DIRECT por padrao', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999991002', 'Cliente Novo');
    expect(conv.leadSource).toBe('WHATSAPP_DIRECT');
  });

  it('setLeadSource do painel persiste a origem', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991003');

    const res = await panel.setLeadSource(conv.id, { leadSource: 'INDICACAO' });
    expect(res.ok).toBe(true);
    const updated = await repository.getConversationById(conv.id);
    expect(updated?.leadSource).toBe('INDICACAO');
  });

  it('rejeita origem invalida e aceita null (limpar)', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991004');

    const bad = await panel.setLeadSource(conv.id, { leadSource: 'GOOGLE_ADS' });
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(400);

    const res = await panel.setLeadSource(conv.id, { leadSource: null });
    expect(res.ok).toBe(true);
    const updated = await repository.getConversationById(conv.id);
    expect(updated?.leadSource).toBeNull();
  });
});

describe('Perda de lead (CANCELADO + motivo)', () => {
  it('markLost move para CANCELADO com motivo e timestamp', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991005', 'Cliente Perdido');

    const res = await panel.markLost(conv.id, { lostReason: 'PRECO_ALTO' });
    expect(res.ok).toBe(true);

    const updated = await repository.getConversationById(conv.id);
    expect(updated?.funnelStatus).toBe('CANCELADO');
    expect(updated?.lostReason).toBe('PRECO_ALTO');
    expect(updated?.lostAt).toBeTruthy();
  });

  it('rejeita motivo de perda invalido', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991006');

    const res = await panel.markLost(conv.id, { lostReason: 'NAO_QUIS' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it('reagir (sair de CANCELADO) limpa motivo e timestamp', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991007');
    await panel.markLost(conv.id, { lostReason: 'SEM_RESPOSTA' });

    const res = await panel.setStatus(conv.id, { status: 'EM_QUALIFICACAO' });
    expect(res.ok).toBe(true);

    const updated = await repository.getConversationById(conv.id);
    expect(updated?.funnelStatus).toBe('EM_QUALIFICACAO');
    expect(updated?.lostReason).toBeNull();
    expect(updated?.lostAt).toBeNull();
  });
});

describe('Timeline unificada de atividades', () => {
  it('registra criacao, orcamento, funil, handoff, perda e pedido', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999991008', 'Timeline Teste');

    repository.seedQuote(QUOTE, undefined, {
      installments: 12,
      monthlyValueCents: 45000,
      parceledTotalCents: 540000,
    });
    await repository.markHighValueOpportunity(conv.id, QUOTE.code);
    await repository.assume(conv.id, 'agent-ana');
    await repository.release(conv.id);
    await repository.setQuoteBling(QUOTE.id, 'bling-1', '999');
    await repository.markLost(conv.id, 'CONCORRENTE');

    const timeline = await repository.listTimeline(conv.id);
    const types = timeline.map((e) => e.type);
    expect(types).toContain('CONVERSATION_CREATED');
    expect(types).toContain('QUOTE_CREATED');
    expect(types).toContain('FUNNEL_STATUS_CHANGED');
    expect(types).toContain('HANDOFF');
    expect(types).toContain('ORDER_EMITTED');
    expect(types).toContain('LEAD_LOST');
    expect(timeline[0]?.type).toBe('LEAD_LOST');
  });

  it('getConversation do painel inclui a timeline', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991009');
    await repository.setFunnelStatus(conv.id, 'ALTA_VALOR');

    const res = await panel.getConversation(conv.id);
    expect(res.ok).toBe(true);
    const data = res.data as { conversation: unknown; messages: unknown[]; timeline: unknown[] };
    expect(data.timeline.length).toBeGreaterThanOrEqual(2);
    expect(data.timeline.some((e) => (e as { type: string }).type === 'FUNNEL_STATUS_CHANGED')).toBe(true);
  });
});

describe('Anotações internas do atendente', () => {
  it('addNote persiste e dispara evento NOTE_ADDED na timeline', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999991015', 'Cliente Negociacao');

    const note = await repository.addNote(conv.id, {
      agentId: 'agent-ana',
      text: 'Cliente pediu desconto de 10% no PIX para fechar hoje.',
    });
    expect(note.text).toContain('desconto');
    expect(note.agentId).toBe('agent-ana');

    const notes = await repository.listNotes(conv.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe(note.text);

    const timeline = await repository.listTimeline(conv.id);
    expect(timeline.some((e) => e.type === 'NOTE_ADDED')).toBe(true);
  });

  it('rejeita anotacao vazia', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999991016');
    await expect(repository.addNote(conv.id, { text: '   ' })).rejects.toThrow('anotacao nao pode ser vazia');
  });

  it('PanelApi.addNote valida texto e getConversation expoe as notas', async () => {
    const repository = new InMemoryMessageRepository();
    const { panel } = buildPanel(repository);
    const conv = await repository.ensureConversation('5511999991017');

    const bad = await panel.addNote(conv.id, { agentId: 'agent-bruno', text: '' });
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(400);

    const res = await panel.addNote(conv.id, {
      agentId: 'agent-bruno',
      text: 'Reagendar ligação para amanhã às 10h.',
    });
    expect(res.ok).toBe(true);

    const detail = await panel.getConversation(conv.id);
    expect(detail.ok).toBe(true);
    const data = detail.data as { notes: Array<{ text: string }> };
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0]?.text).toContain('Reagendar');
  });
});

describe('Follow-up de orcamentos inativos', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');

  async function makeStaleQuoteConversation(repository: InMemoryMessageRepository, whatsapp: string) {
    const conv = await repository.ensureConversation(whatsapp, 'Cliente Inativo');
    repository.seedQuote(
      { ...QUOTE, id: `quote-${whatsapp}`, code: `Q-${whatsapp.slice(-4)}` },
      conv.id,
      { installments: 12, monthlyValueCents: 45000, parceledTotalCents: 540000 },
    );
    await repository.setFunnelStatus(conv.id, 'ALTA_VALOR');
    await repository.touchConversation(conv.id, { at: '2026-01-01T10:00:00.000Z' });
    return conv;
  }

  it('envia lembrete para orcamento ALTA_VALOR sem contato ha 24h+', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await makeStaleQuoteConversation(repository, '5511999991010');
    const sent: Array<{ to: string; text: string }> = [];
    const job = createQuoteFollowUpJob({
      repository,
      evolution: {
        sendText: async (to: string, text: string) => {
          sent.push({ to, text });
        },
      } as unknown as EvolutionApi,
      inactivityHours: 24,
      now: () => now,
      logger: () => {},
    });

    const notified = await job.scan();
    expect(notified).toBe(1);
    expect(sent[0]?.to).toBe(conv.whatsappId);
    expect(sent[0]?.text).toContain('Q-1010');

    const messages = await repository.listMessages(conv.id);
    expect(messages.items).toHaveLength(1);
    expect(messages.items[0]?.direction).toBe('outbound');

    const timeline = await repository.listTimeline(conv.id);
    expect(timeline.some((e) => e.type === 'FOLLOW_UP_SENT')).toBe(true);
  });

  it('nao reenvia no mesmo ciclo (lastFollowUpAt registrado)', async () => {
    const repository = new InMemoryMessageRepository();
    await makeStaleQuoteConversation(repository, '5511999991011');
    const sent: string[] = [];
    const job = createQuoteFollowUpJob({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      inactivityHours: 24,
      now: () => now,
      logger: () => {},
    });

    expect(await job.scan()).toBe(1);
    expect(await job.scan()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('pula conversa com contato recente e conversa fora do ALTA_VALOR', async () => {
    const repository = new InMemoryMessageRepository();
    const recent = await repository.ensureConversation('5511999991012', 'Cliente Recente');
    repository.seedQuote({ ...QUOTE, id: 'quote-recent', code: 'Q-REC1' }, recent.id, {});
    await repository.setFunnelStatus(recent.id, 'ALTA_VALOR');
    await repository.touchConversation(recent.id, { at: now.toISOString() });

    const noQuote = await repository.ensureConversation('5511999991013', 'Sem Orcamento');
    await repository.setFunnelStatus(noQuote.id, 'ALTA_VALOR');
    await repository.touchConversation(noQuote.id, { at: '2026-01-01T10:00:00.000Z' });

    const sent: string[] = [];
    const job = createQuoteFollowUpJob({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      inactivityHours: 24,
      now: () => now,
      logger: () => {},
    });

    expect(await job.scan()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('pula conversa em atendimento humano', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await makeStaleQuoteConversation(repository, '5511999991014');
    await repository.assume(conv.id, 'agent-bruno');

    const sent: string[] = [];
    const job = createQuoteFollowUpJob({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      inactivityHours: 24,
      now: () => now,
      logger: () => {},
    });

    expect(await job.scan()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('buildFollowUpMessage referencia o codigo do orcamento', () => {
    const msg = buildFollowUpMessage({
      customerName: 'Cliente Inativo',
      quote: {
        code: 'Q-FOLLOW1',
        totalCents: 500000,
        pixTotalCents: 475000,
        installments: 12,
        monthlyValueCents: 45000,
        parceledTotalCents: 540000,
        blingOrderId: null,
        blingNumber: null,
        blingStatus: null,
        items: [],
      },
    });
    expect(msg).toContain('Q-FOLLOW1');
    expect(msg).toContain('Olá, Cliente!');
  });
});
