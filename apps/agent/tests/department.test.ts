import { describe, it, expect } from 'vitest';
import { InMemoryMessageRepository } from '../src/prisma/MessageRepository.js';
import { PanelApi } from '../src/panel/PanelApi.js';
import { createFunnelAutomation, buildFunnelMessage } from '../src/agent/funnelAutomation.js';
import type { EvolutionApi } from '../src/integration/evolution/EvolutionApi.js';

// ============================================================================
// Modulo de Filas e Atribuicao de Departamentos + Automacao por estagio do funil
// ============================================================================

describe('Departamentos e atribuicao de atendente', () => {
  function buildPanel() {
    const repository = new InMemoryMessageRepository();
    const sent: Array<{ to: string; text: string }> = [];
    const evolution = {
      sendText: async (to: string, text: string) => {
        sent.push({ to, text });
      },
    } as unknown as EvolutionApi;
    const panel = new PanelApi({ repository, evolution, bling: {} as never, apiKey: 'k' });
    return { repository, evolution, panel, sent };
  }

  it('setDepartment atribui departamento e atendente', async () => {
    const { repository, panel } = buildPanel();
    const conv = await repository.ensureConversation('5511999991111', 'Cliente Demo');

    const res = await panel.assignDepartment(conv.id, {
      department: 'SUPORTE',
      assignedAgentId: 'agent-bruno',
    });
    expect(res.ok).toBe(true);

    const updated = await repository.getConversationById(conv.id);
    expect(updated?.department).toBe('SUPORTE');
    expect(updated?.assignedAgentId).toBe('agent-bruno');
  });

  it('rejeita departamento invalido e atendente inexistente', async () => {
    const { repository, panel } = buildPanel();
    const conv = await repository.ensureConversation('5511999992222');

    const badDept = await panel.assignDepartment(conv.id, { department: 'TI' });
    expect(badDept.ok).toBe(false);
    expect(badDept.status).toBe(400);

    const badAgent = await panel.assignDepartment(conv.id, { assignedAgentId: 'nope' });
    expect(badAgent.ok).toBe(false);
    expect(badAgent.status).toBe(400);
  });

  it('listAgents retorna atendentes ativos', async () => {
    const { panel } = buildPanel();
    const res = await panel.listAgents();
    expect(res.ok).toBe(true);
    const data = res.data as { agents: Array<{ name: string }> };
    expect(data.agents.length).toBeGreaterThan(0);
    expect(data.agents.some((a) => a.name.includes('Ana'))).toBe(true);
  });
});

describe('Automacao por mudanca de estagio do funil', () => {
  it('ALTA_VALOR envia resumo do orcamento com instrucoes de pagamento', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999993333', 'Maria Compradora');
    repository.seedQuote(
      {
        id: 'quote-3',
        code: 'Q-ABC123',
        totalCents: 500000,
        pixTotalCents: 475000,
        customer: { name: 'Maria Compradora', phone: '5511999993333' },
        items: [
          { sku: 'CPU-8600G', name: 'AMD Ryzen 5 8600G', unitPriceCents: 119990, quantity: 1 },
          { sku: 'MB-B650M', name: 'Gigabyte B650M Gaming WiFi', unitPriceCents: 149990, quantity: 1 },
        ],
      },
      conv.id,
      { installments: 12, monthlyValueCents: 45000, parceledTotalCents: 540000 },
    );

    const sent: string[] = [];
    const automation = createFunnelAutomation({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      logger: () => {},
    });

    await automation(conv.id, 'ALTA_VALOR');

    expect(sent).toHaveLength(1);
    const msg = sent[0].replace(/\u00A0/g, ' ');
    expect(msg).toContain('Q-ABC123');
    expect(msg).toContain('R$ 4.750,00');
    expect(msg).toContain('12x');
    expect(msg).toContain('PIX');

    const messages = await repository.listMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.direction).toBe('outbound');
    expect(messages[0]?.text).toContain('Q-ABC123');
  });

  it('AGUARDANDO_NF envia confirmacao de pagamento e NF', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999994444', 'Joao Pagante');

    const sent: string[] = [];
    const automation = createFunnelAutomation({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      logger: () => {},
    });

    await automation(conv.id, 'AGUARDANDO_NF');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Pagamento confirmado');
    expect(sent[0]).toContain('nota fiscal');
  });

  it('estagios sem automacao nao disparam mensagem', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999995555');

    const sent: string[] = [];
    const automation = createFunnelAutomation({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      logger: () => {},
    });

    await automation(conv.id, 'NOVO');
    await automation(conv.id, 'CONCLUIDO');
    expect(sent).toHaveLength(0);
  });

  it('setStatus do painel dispara a automacao AGUARDANDO_NF', async () => {
    const repository = new InMemoryMessageRepository();
    const conv = await repository.ensureConversation('5511999996666', 'Cliente Painel');
    const sent: string[] = [];
    const panel = new PanelApi({
      repository,
      evolution: {
        sendText: async (_to: string, text: string) => {
          sent.push(text);
        },
      } as unknown as EvolutionApi,
      bling: {} as never,
      apiKey: 'k',
      funnelAutomation: createFunnelAutomation({ repository, evolution: { sendText: async (_to, text) => sent.push(text) } as unknown as EvolutionApi, logger: () => {} }),
    });

    const res = await panel.setStatus(conv.id, { status: 'AGUARDANDO_NF' });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Pagamento confirmado');
  });
});

describe('buildFunnelMessage - formatacao', () => {
  it('formata valores em BRL com multiplas parcelas', () => {
    const msg = buildFunnelMessage('ALTA_VALOR', {
      customerName: 'Fulano',
      quote: {
        code: 'Q-XYZ789',
        totalCents: 100000,
        pixTotalCents: 95000,
        installments: 10,
        monthlyValueCents: 10550,
        parceledTotalCents: 105500,
        blingOrderId: null,
        blingNumber: null,
        blingStatus: null,
        items: [{ sku: null, name: 'Item Genérico', unitPriceCents: 100000, quantity: 1 }],
      },
    });
    const text = (msg as string).replace(/\u00A0/g, ' ');
    expect(text).toContain('10x de R$ 105,50');
    expect(text).toContain('R$ 950,00');
  });
});
