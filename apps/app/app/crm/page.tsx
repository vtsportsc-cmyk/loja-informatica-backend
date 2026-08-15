'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUSES, FUNNEL_STATUS_LABELS, FUNNEL_STATUS_COLORS } from '@/lib/funnel';
import { DEPARTMENTS, DEPARTMENT_LABELS, DEPARTMENT_COLORS, isDepartment, type Department } from '@/lib/departments';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type LeadSource, type LostReason } from '@/lib/leads';

type ModuleId = 'funil' | 'atendimento' | 'pedidos';

interface Agent {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  active: boolean;
}

interface QuoteItem {
  sku: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

interface QuoteSummary {
  code: string;
  totalCents: number;
  pixTotalCents: number;
  installments: number;
  monthlyValueCents: number;
  parceledTotalCents: number;
  blingOrderId: string | null;
  blingNumber: string | null;
  blingStatus: string | null;
  items: QuoteItem[];
}

interface Conversation {
  id: string;
  whatsappId: string;
  customerName: string | null;
  funnelStatus: string;
  department: string | null;
  leadSource: string | null;
  lostReason: string | null;
  lostAt: string | null;
  lastFollowUpAt: string | null;
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  quote?: QuoteSummary | null;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string | null;
  agentId: string | null;
  createdAt: string;
}

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

interface Note {
  id: string;
  agentId: string | null;
  text: string;
  createdAt: string;
}

interface DetailResponse {
  conversation: Conversation;
  messages: Message[];
  timeline: TimelineEvent[];
  notes: Note[];
}

const MODULES: Array<{ id: ModuleId; label: string; hint: string }> = [
  { id: 'funil', label: 'Funil de Vendas', hint: 'Kanban de leads' },
  { id: 'atendimento', label: 'Atendimento', hint: 'WhatsApp multi-atendente' },
  { id: 'pedidos', label: 'Pedidos', hint: 'Orçamentos e emissão' },
];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function CrmPage() {
  const [module, setModule] = useState<ModuleId>('funil');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [agentName, setAgentName] = useState('');
  const [draft, setDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<string>('');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('todos');
  const [departmentDraft, setDepartmentDraft] = useState<string>('none');
  const [agentDraft, setAgentDraft] = useState<string>('none');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingLostId, setPendingLostId] = useState<string | null>(null);
  const [lostReasonDraft, setLostReasonDraft] = useState<LostReason>('OUTRO');
  const [leadSourceDraft, setLeadSourceDraft] = useState<string>('none');
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'resumo' | 'anotacoes'>('resumo');
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    setAgentName(localStorage.getItem('crm-agent-name') ?? '');
  }, []);

  const refreshList = useCallback(async () => {
    const res = await fetch('/api/crm/conversations');
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? 'falha ao listar conversas');
      return;
    }
    setConversations(body.conversations ?? []);
    setLoading(false);
  }, []);

  const refreshAgents = useCallback(async () => {
    const res = await fetch('/api/crm/agents');
    const body = await res.json();
    if (res.ok) setAgents(body.agents ?? []);
  }, []);

  useEffect(() => {
    void refreshList();
    void refreshAgents();
  }, [refreshList, refreshAgents]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id)}`);
    const body = await res.json();
    if (res.ok) {
      setDetail(body);
      setStatusDraft(body.conversation.funnelStatus);
      setDepartmentDraft(body.conversation.department ?? 'none');
      setAgentDraft(body.conversation.assignedAgentId ?? 'none');
      setLeadSourceDraft(body.conversation.leadSource ?? 'none');
    } else {
      setError(body.error ?? 'falha ao carregar a conversa');
    }
  }, []);

  async function openConversationInChat(id: string) {
    setModule('atendimento');
    await openConversation(id);
  }

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    const res = await fetch('/api/crm/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedId, agentId: agentName || null, text: draft.trim() }),
    });
    if (res.ok) {
      setDraft('');
      await openConversation(selectedId);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao enviar mensagem');
    }
  }

  async function handoff(action: 'assume' | 'release') {
    if (!selectedId) return;
    if (action === 'assume' && !agentName.trim()) {
      setError('informe seu nome (agente) para assumir o atendimento');
      return;
    }
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, agentId: agentName.trim() || undefined }),
    });
    if (res.ok) {
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao alternar o atendimento');
    }
  }

  async function changeStatus() {
    if (!selectedId || !statusDraft) return;
    if (statusDraft === 'CANCELADO') {
      setPendingLostId(selectedId);
      return;
    }
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: statusDraft }),
    });
    if (res.ok) {
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao atualizar o funil');
    }
  }

  async function confirmLost() {
    if (!pendingLostId) return;
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(pendingLostId)}/lost`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lostReason: lostReasonDraft }),
    });
    const id = pendingLostId;
    setPendingLostId(null);
    if (res.ok) {
      setError(null);
      await openConversation(id);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao marcar como perdido');
    }
  }

  async function saveLeadSource() {
    if (!selectedId) return;
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadSource: leadSourceDraft === 'none' ? null : leadSourceDraft }),
    });
    if (res.ok) {
      setError(null);
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao salvar a origem do lead');
    }
  }

  async function saveNote() {
    if (!selectedId || !noteDraft.trim()) return;
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agentName.trim() || null, text: noteDraft.trim() }),
    });
    if (res.ok) {
      setNoteDraft('');
      setError(null);
      await openConversation(selectedId);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao salvar a anotação');
    }
  }

  async function saveDepartment() {
    if (!selectedId) return;
    const res = await fetch(
      `/api/crm/conversations/${encodeURIComponent(selectedId)}/department`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          department: departmentDraft === 'none' ? null : departmentDraft,
          assignedAgentId: agentDraft === 'none' ? null : agentDraft,
        }),
      },
    );
    if (res.ok) {
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao atribuir departamento');
    }
  }

  async function emitOrder(id: string) {
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'AGUARDANDO_NF' }),
    });
    if (res.ok) {
      setError(null);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao emitir o pedido');
    }
  }

  const selected = detail?.conversation ?? null;
  const agentLabel = useCallback(
    (id: string | null): string => {
      if (!id) return '—';
      return agents.find((a) => a.id === id)?.name ?? id;
    },
    [agents],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const matchesQuery =
        !q ||
        (c.customerName ?? '').toLowerCase().includes(q) ||
        c.whatsappId.includes(q) ||
        (c.quote?.code ?? '').toLowerCase().includes(q);
      const matchesDepartment =
        departmentFilter === 'todos' ||
        (c.department ?? '') === departmentFilter ||
        (departmentFilter === 'sem-departamento' && !c.department);
      return matchesQuery && matchesDepartment;
    });
  }, [conversations, search, departmentFilter]);

  const orders = useMemo(() => conversations.filter((c) => c.quote), [conversations]);
  const ordersStats = useMemo(() => {
    const totalPix = orders.reduce((sum, c) => sum + (c.quote?.pixTotalCents ?? 0), 0);
    return {
      count: orders.length,
      totalPix,
      awaitingNf: orders.filter((c) => c.funnelStatus === 'AGUARDANDO_NF').length,
      blingEmitted: orders.filter((c) => c.quote?.blingNumber).length,
    };
  }, [orders]);

  return (
    <div className="flex flex-col gap-3 p-4 lg:h-[calc(100vh-120px)]">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-black tracking-tight">Painel de Operações</h1>
          <nav className="flex gap-1">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => setModule(m.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  module === m.id
                    ? 'bg-brand text-night-950'
                    : 'bg-night-800 text-zinc-300 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost hidden items-center gap-2 !px-3 !py-1.5 !text-xs sm:flex"
            onClick={() => setPaletteOpen(true)}
            title="Busca rápida (Ctrl+K)"
          >
            <span>Buscar</span>
            <kbd className="rounded border border-night-600 bg-night-800 px-1 font-mono text-[9px] text-zinc-400">
              Ctrl+K
            </kbd>
          </button>
          <input
            className="input w-52"
            placeholder="Seu nome (agente)"
            value={agentName}
            onChange={(e) => {
              setAgentName(e.target.value);
              localStorage.setItem('crm-agent-name', e.target.value);
            }}
          />
          <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => void refreshList()}>
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/60 px-4 py-2 text-xs text-red-300">
          {error}
          <button className="ml-2 font-bold" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-zinc-500">Carregando operações...</p>
      ) : module === 'funil' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 rounded-lg bg-night-800 p-1">
              <button
                onClick={() => setViewMode('kanban')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === 'kanban' ? 'bg-brand text-night-950' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Kanban
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === 'table' ? 'bg-brand text-night-950' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Tabela
              </button>
            </div>
            <span className="text-[10px] text-zinc-500">{conversations.length} conversas</span>
          </div>
          {viewMode === 'kanban' ? (
            <Kanban conversations={conversations} onOpen={openConversationInChat} />
          ) : (
            <DenseTable conversations={conversations} agents={agents} onOpen={openConversationInChat} />
          )}
        </div>
      ) : module === 'atendimento' ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_1fr_320px]">
          <div className="card flex min-h-0 flex-col overflow-hidden !p-0">
            <div className="border-b border-night-700 p-2">
              <input
                className="input !py-1.5 !text-xs"
                placeholder="Buscar conversa ou pedido..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  className="select !py-1 !text-[11px]"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  title="Filtrar por departamento (fila)"
                >
                  <option value="todos">Todos os departamentos</option>
                  <option value="sem-departamento">Sem departamento</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {DEPARTMENT_LABELS[d]}
                    </option>
                  ))}
                </select>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                  {filtered.length}/{conversations.length}
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-zinc-500">
                  Nenhuma conversa encontrada.
                </p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void openConversation(c.id)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                    selectedId === c.id ? 'bg-brand/15' : 'hover:bg-night-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">
                      {c.customerName || c.whatsappId}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {fmtTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'}`}
                    />
                    <span className="truncate text-zinc-400">{c.whatsappId}</span>
                    {c.department && (
                      <span className="rounded bg-brand/15 px-1 text-brand">
                        {DEPARTMENT_LABELS[c.department as Department] ?? c.department}
                      </span>
                    )}
                    {c.quote && (
                      <span className="ml-auto font-mono text-zinc-500">{c.quote.code}</span>
                    )}
                  </div>
                  {(c.unreadCount > 0 || c.humanMode) && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                      {c.unreadCount > 0 && (
                        <span className="rounded bg-red-500 px-1 font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                      <span
                        className={`rounded px-1 ${
                          c.humanMode
                            ? 'bg-brand/20 text-brand'
                            : 'bg-blue-500/20 text-blue-300'
                        }`}
                      >
                        {c.humanMode
                          ? `humano${c.assignedAgentId ? `:${c.assignedAgentId}` : ''}`
                          : 'IA'}
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="card flex min-h-0 flex-col overflow-hidden !p-0">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                Selecione uma conversa à esquerda.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-night-700 px-3 py-2">
                  <div>
                    <h2 className="text-sm font-bold">{selected.customerName || selected.whatsappId}</h2>
                    <p className="text-[10px] text-zinc-500">
                      {selected.whatsappId} · atualizado {fmtDate(selected.lastMessageAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.humanMode ? (
                      <button
                        className="btn-ghost !px-2 !py-1 !text-[11px]"
                        onClick={() => void handoff('release')}
                      >
                        Liberar para a IA
                      </button>
                    ) : (
                      <button
                        className="btn-primary !px-2 !py-1 !text-[11px]"
                        onClick={() => void handoff('assume')}
                      >
                        Assumir (humano)
                      </button>
                    )}
                    <span className="text-[10px] text-zinc-500">
                      {selected.humanMode ? 'atendimento humano' : 'IA respondendo'}
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {detail?.messages.length === 0 && (
                    <p className="text-center text-xs text-zinc-500">Sem mensagens ainda.</p>
                  )}
                  {detail?.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-xl px-3 py-1.5 text-xs ${
                          m.direction === 'inbound'
                            ? 'bg-night-700 text-zinc-100'
                            : 'bg-brand/20 text-brand-dark'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.text}</p>
                        <p className="mt-0.5 text-[9px] opacity-70">
                          {m.direction === 'inbound' ? 'cliente' : m.agentId ? m.agentId : 'IA'} ·{' '}
                          {fmtTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-night-700 p-3">
                  <div className="flex gap-2">
                    <input
                      className="input !py-1.5 !text-xs"
                      placeholder="Mensagem para o cliente..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void sendMessage();
                      }}
                    />
                    <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => void sendMessage()}>
                      Enviar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="card flex min-h-0 flex-col overflow-hidden !p-0">
            {!selected ? (
              <p className="p-4 text-xs text-zinc-500">Contexto do cliente aparecerá aqui.</p>
            ) : (
              <>
                <div className="flex gap-1 border-b border-night-700 p-2">
                  <button
                    onClick={() => setSidebarTab('resumo')}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                      sidebarTab === 'resumo' ? 'bg-brand text-night-950' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Resumo
                  </button>
                  <button
                    onClick={() => setSidebarTab('anotacoes')}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                      sidebarTab === 'anotacoes' ? 'bg-brand text-night-950' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Anotações
                    {detail && detail.notes.length > 0 && (
                      <span className="ml-1 rounded bg-night-700 px-1 text-[9px] text-zinc-300">
                        {detail.notes.length}
                      </span>
                    )}
                  </button>
                </div>
                {sidebarTab === 'resumo' ? (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Atribuição
                  </h3>
                  <div className="mt-1.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <select
                        className="select !py-1.5 !text-xs"
                        value={departmentDraft}
                        onChange={(e) => setDepartmentDraft(e.target.value)}
                        title="Fila/departamento"
                      >
                        <option value="none">Sem departamento</option>
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {DEPARTMENT_LABELS[d]}
                          </option>
                        ))}
                      </select>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          departmentDraft !== 'none' && isDepartment(departmentDraft)
                            ? DEPARTMENT_COLORS[departmentDraft as Department]
                            : 'bg-zinc-500'
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="select !py-1.5 !text-xs"
                        value={agentDraft}
                        onChange={(e) => setAgentDraft(e.target.value)}
                        title="Atendente responsável"
                      >
                        <option value="none">Nenhum atendente</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.role ? ` · ${a.role}` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn-ghost shrink-0 !px-2 !py-1 !text-[11px]"
                        onClick={() => void saveDepartment()}
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Origem do lead
                  </h3>
                  <div className="mt-1.5 flex items-center gap-2">
                    <select
                      className="select !py-1.5 !text-xs"
                      value={leadSourceDraft}
                      onChange={(e) => setLeadSourceDraft(e.target.value)}
                      title="Origem do lead"
                    >
                      <option value="none">Sem origem</option>
                      {LEAD_SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_SOURCE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-ghost !px-2 !py-1 !text-[11px]"
                      onClick={() => void saveLeadSource()}
                    >
                      Salvar
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Funil
                  </h3>
                  <div className="mt-1.5 flex items-center gap-2">
                    <select
                      className="select !py-1.5 !text-xs"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                    >
                      {FUNNEL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {FUNNEL_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <button className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => void changeStatus()}>
                      Salvar
                    </button>
                  </div>
                  {selected.funnelStatus === 'CANCELADO' && (
                    <p className="mt-1.5 rounded bg-red-950/60 px-2 py-1 text-[10px] text-red-300">
                      Pedido perdido
                      {selected.lostReason
                        ? ` — ${LOST_REASON_LABELS[selected.lostReason as LostReason] ?? selected.lostReason}`
                        : ''}
                      {selected.lostAt ? ` · ${fmtDate(selected.lostAt)}` : ''}
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Pedido
                  </h3>
                  {selected.quote ? (
                    <OrderSummary quote={selected.quote} status={selected.funnelStatus} onEmit={() => void emitOrder(selected.id)} />
                  ) : (
                    <p className="mt-1.5 text-xs text-zinc-500">
                      Nenhum orçamento do Monte seu PC vinculado a esta conversa.
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Timeline
                  </h3>
                  <Timeline events={detail?.timeline ?? []} />
                </div>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <NotesPanel
                      notes={detail?.notes ?? []}
                      agentName={agentName}
                      draft={noteDraft}
                      onDraftChange={setNoteDraft}
                      onSave={() => void saveNote()}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <OrdersTable
          orders={orders}
          stats={ordersStats}
          onOpen={openConversationInChat}
          onEmit={(id) => void emitOrder(id)}
        />
      )}

      {pendingLostId && (
        <LostReasonModal
          customerName={selected?.customerName ?? null}
          value={lostReasonDraft}
          onChange={(r) => setLostReasonDraft(r)}
          onConfirm={() => void confirmLost()}
          onCancel={() => {
            setPendingLostId(null);
            setStatusDraft(detail?.conversation.funnelStatus ?? '');
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          conversations={conversations}
          onClose={() => setPaletteOpen(false)}
          onSelect={(id) => {
            setPaletteOpen(false);
            void openConversationInChat(id);
          }}
        />
      )}
    </div>
  );
}

function Kanban({
  conversations,
  onOpen,
}: {
  conversations: Conversation[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
      {FUNNEL_STATUSES.map((status) => {
        const cards = conversations.filter((c) => c.funnelStatus === status);
        return (
          <div key={status} className="card flex min-w-[250px] flex-col !p-0">
            <div className="sticky top-0 flex items-center justify-between border-b border-night-700 px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${FUNNEL_STATUS_COLORS[status] ?? 'bg-zinc-500'}`}
                />
                <span className="text-xs font-bold">{FUNNEL_STATUS_LABELS[status]}</span>
              </div>
              <span className="rounded bg-night-700 px-1.5 text-[10px] text-zinc-400">
                {cards.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {cards.length === 0 && (
                <p className="px-2 py-6 text-center text-[10px] text-zinc-600">vazio</p>
              )}
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  className="w-full rounded-lg border border-night-700 bg-night-800 p-2 text-left transition-colors hover:border-brand/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">
                      {c.customerName || c.whatsappId}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {fmtTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
                    {c.quote && (
                      <>
                        <span className="rounded bg-brand/15 px-1 font-mono text-brand">
                          {c.quote.code}
                        </span>
                        <span className="font-semibold text-brand">
                          {formatBRL(c.quote.pixTotalCents)}
                        </span>
                      </>
                    )}
                    {c.unreadCount > 0 && (
                      <span className="rounded bg-red-500 px-1 font-bold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                    <span
                      className={`ml-auto rounded px-1 ${
                        c.humanMode ? 'bg-brand/20 text-brand' : 'bg-blue-500/20 text-blue-300'
                      }`}
                    >
                      {c.humanMode ? 'humano' : 'IA'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderSummary({
  quote,
  status,
  onEmit,
}: {
  quote: QuoteSummary;
  status: string;
  onEmit: () => void;
}) {
  const emitted = Boolean(quote.blingNumber);
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-night-700 bg-night-800 p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-brand">{quote.code}</span>
        <span className="text-[10px] text-zinc-400">{quote.items.length} itens</span>
      </div>
      <ul className="space-y-1 text-[11px] text-zinc-300">
        {quote.items.slice(0, 6).map((item, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">
              {item.quantity}x {item.name}
            </span>
            <span className="shrink-0 text-zinc-400">
              {formatBRL(item.unitPriceCents * item.quantity)}
            </span>
          </li>
        ))}
        {quote.items.length > 6 && (
          <li className="text-[10px] text-zinc-500">+ {quote.items.length - 6} itens...</li>
        )}
      </ul>
      <dl className="space-y-0.5 border-t border-night-700 pt-1.5 text-[11px]">
        <div className="flex justify-between">
          <dt className="text-zinc-400">Subtotal</dt>
          <dd>{formatBRL(quote.totalCents)}</dd>
        </div>
        <div className="flex justify-between text-brand">
          <dt>PIX</dt>
          <dd>{formatBRL(quote.pixTotalCents)}</dd>
        </div>
        <div className="flex justify-between text-zinc-500">
          <dt>ou {quote.installments}x de</dt>
          <dd>{formatBRL(quote.monthlyValueCents)}</dd>
        </div>
      </dl>
      {emitted ? (
        <p className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300">
          Pedido Bling #{quote.blingNumber}
          {quote.blingStatus ? ` · ${quote.blingStatus}` : ''} — emissão/expedição iniciada.
        </p>
      ) : status === 'AGUARDANDO_NF' ? (
        <p className="rounded bg-amber-500/15 px-2 py-1 text-[10px] text-amber-300">
          Aguardando emissão da NF (Bling).
        </p>
      ) : (
        <button className="btn-primary w-full !px-2 !py-1.5 !text-[11px]" onClick={onEmit}>
          Emitir pedido (NF/expedição)
        </button>
      )}
    </div>
  );
}

function OrdersTable({
  orders,
  stats,
  onOpen,
  onEmit,
}: {
  orders: Conversation[];
  stats: { count: number; totalPix: number; awaitingNf: number; blingEmitted: number };
  onOpen: (id: string) => void;
  onEmit: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Pedidos (orçamentos)" value={String(stats.count)} />
        <StatCard label="Soma total PIX" value={formatBRL(stats.totalPix)} />
        <StatCard label="Aguardando NF" value={String(stats.awaitingNf)} />
        <StatCard label="Emitidos no Bling" value={String(stats.blingEmitted)} />
      </div>

      <div className="card min-h-0 flex-1 overflow-auto !p-0">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Atualizado</th>
              <th className="px-3 py-2 text-right">Itens</th>
              <th className="px-3 py-2 text-right">Total PIX</th>
              <th className="px-3 py-2 text-right">Parcelado</th>
              <th className="px-3 py-2">Funil</th>
              <th className="px-3 py-2">Bling</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                  Nenhum pedido vinculado ainda. Os orçamentos confirmados pelo WhatsApp aparecem aqui.
                </td>
              </tr>
            )}
            {orders.map((c) => {
              const q = c.quote!;
              return (
                <tr key={c.id} className="border-t border-night-800 hover:bg-night-800/60">
                  <td className="px-3 py-2 font-mono font-bold text-brand">{q.code}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{c.customerName || c.whatsappId}</span>
                    <span className="block text-[10px] text-zinc-500">{c.whatsappId}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{fmtDate(c.lastMessageAt)}</td>
                  <td className="px-3 py-2 text-right">{q.items.length}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand">
                    {formatBRL(q.pixTotalCents)}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-400">
                    {q.installments}x de {formatBRL(q.monthlyValueCents)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'
                      } bg-opacity-20 text-zinc-100`}
                    >
                      {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {q.blingNumber ? `#${q.blingNumber}` : q.blingStatus ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost !px-2 !py-1 !text-[10px]" onClick={() => onOpen(c.id)}>
                        Conversa
                      </button>
                      {!q.blingNumber && c.funnelStatus !== 'AGUARDANDO_NF' && (
                        <button className="btn-primary !px-2 !py-1 !text-[10px]" onClick={() => onEmit(c.id)}>
                          Emitir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-black text-zinc-100">{value}</p>
    </div>
  );
}

const TIMELINE_TYPE_META: Record<string, { label: string; color: string }> = {
  CONVERSATION_CREATED: { label: 'Conversa', color: 'bg-zinc-500' },
  QUOTE_CREATED: { label: 'Orçamento', color: 'bg-brand' },
  FUNNEL_STATUS_CHANGED: { label: 'Funil', color: 'bg-slate-400' },
  HANDOFF: { label: 'Atendimento', color: 'bg-blue-500' },
  ORDER_EMITTED: { label: 'Pedido', color: 'bg-emerald-500' },
  LEAD_LOST: { label: 'Perdido', color: 'bg-red-500' },
  FOLLOW_UP_SENT: { label: 'Follow-up', color: 'bg-amber-500' },
};

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-zinc-500">
        Sem atividades registradas nesta conversa ainda.
      </p>
    );
  }
  return (
    <ol className="mt-1.5 space-y-2">
      {events.map((ev) => {
        const meta = TIMELINE_TYPE_META[ev.type] ?? { label: ev.type, color: 'bg-zinc-500' };
        return (
          <li key={ev.id} className="relative flex gap-2 pl-4">
            <span
              className={`absolute left-0 top-1 h-2 w-2 rounded-full ${meta.color}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold leading-tight text-zinc-200">{ev.title}</p>
              {ev.detail && (
                <p className="mt-0.5 text-[10px] leading-snug text-zinc-400">{ev.detail}</p>
              )}
              <p className="mt-0.5 text-[9px] text-zinc-500">
                <span className="rounded bg-night-800 px-1">{meta.label}</span>{' '}
                {fmtDate(ev.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function LostReasonModal({
  customerName,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  customerName: string | null;
  value: LostReason;
  onChange: (r: LostReason) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 p-4">
      <div className="card w-full max-w-sm">
        <h3 className="text-sm font-bold">Marcar como perdido</h3>
        <p className="mt-1 text-xs text-zinc-400">
          A conversa de <span className="font-semibold text-zinc-200">{customerName ?? '—'}</span> será
          movida para <span className="font-semibold text-red-300">Cancelado / Perdido</span>.
        </p>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          Motivo da perda
        </p>
        <div className="mt-1.5 space-y-1.5">
          {LOST_REASONS.map((r) => (
            <label
              key={r}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                value === r
                  ? 'border-red-500/60 bg-red-950/40 text-red-200'
                  : 'border-night-700 bg-night-800 text-zinc-300 hover:border-night-500'
              }`}
            >
              <input
                type="radio"
                name="lost-reason"
                className="accent-red-500"
                checked={value === r}
                onChange={() => onChange(r)}
              />
              {LOST_REASON_LABELS[r]}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={onConfirm}>
            Confirmar perda
          </button>
        </div>
      </div>
    </div>
  );
}

function DenseTable({
  conversations,
  agents,
  onOpen,
}: {
  conversations: Conversation[];
  agents: Agent[];
  onOpen: (id: string) => void;
}) {
  const rows = useMemo(
    () => [...conversations].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
    [conversations],
  );
  const agentLabel = useCallback(
    (id: string | null): string => {
      if (!id) return '—';
      return agents.find((a) => a.id === id)?.name ?? id;
    },
    [agents],
  );

  return (
    <div className="card min-h-0 flex-1 overflow-auto !p-0">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-night-800 text-[10px] uppercase tracking-wider text-zinc-400">
          <tr>
            <th className="px-3 py-2 text-left">Cliente</th>
            <th className="px-3 py-2 text-left">Telefone</th>
            <th className="px-3 py-2 text-left">Peças Principais</th>
            <th className="px-3 py-2 text-left">Valor PIX/Parcelado</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Atendente Responsável</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-10 text-center text-zinc-500">
                Nenhuma conversa encontrada.
              </td>
            </tr>
          )}
          {rows.map((c) => {
            const items = c.quote?.items ?? [];
            const parts = items
              .slice(0, 2)
              .map((i) => `${i.quantity}x ${i.name}`)
              .join(' · ');
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c.id)}
                className="cursor-pointer border-t border-night-800 transition-colors hover:bg-brand/10"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'}`}
                    />
                    <span className="font-semibold text-zinc-100">
                      {c.customerName || c.whatsappId}
                    </span>
                    {c.quote && (
                      <span className="font-mono text-[10px] text-brand">{c.quote.code}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-400">{c.whatsappId}</td>
                <td className="max-w-[260px] truncate px-3 py-2 text-zinc-300">
                  {items.length === 0 ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    <>
                      {parts}
                      {items.length > 2 && (
                        <span className="text-zinc-500"> +{items.length - 2} itens</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.quote ? (
                    <>
                      <span className="font-semibold text-brand">
                        {formatBRL(c.quote.pixTotalCents)}
                      </span>
                      <span className="ml-1 text-[10px] text-zinc-400">
                        ou {c.quote.installments}x {formatBRL(c.quote.monthlyValueCents)}
                      </span>
                    </>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'
                    } bg-opacity-20 text-zinc-100`}
                  >
                    {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-400">{agentLabel(c.assignedAgentId)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NotesPanel({
  notes,
  agentName,
  draft,
  onDraftChange,
  onSave,
}: {
  notes: Note[];
  agentName: string;
  draft: string;
  onDraftChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {notes.length === 0 && (
          <p className="py-6 text-center text-xs text-zinc-500">
            Nenhuma anotação ainda. Registre observações da negociação aqui.
          </p>
        )}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border border-night-700 bg-night-800 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-brand">
                {n.agentId || 'Atendente'}
              </span>
              <span className="text-[9px] text-zinc-500">{fmtDate(n.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-zinc-200">{n.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-night-700 pt-2">
        <textarea
          className="input min-h-[72px] !text-xs"
          placeholder={`Anotação interna${agentName ? ` (${agentName})` : ''}...`}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onSave();
          }}
        />
        <div className="mt-1.5 flex justify-end">
          <button
            className="btn-primary !px-3 !py-1.5 !text-[11px]"
            disabled={!draft.trim()}
            onClick={onSave}
          >
            Salvar anotação
          </button>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({
  conversations,
  onClose,
  onSelect,
}: {
  conversations: Conversation[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations.slice(0, 8);
    return conversations
      .filter((c) => {
        const haystack = [
          c.customerName ?? '',
          c.whatsappId,
          c.quote?.code ?? '',
          ...(c.quote?.items ?? []).map((i) => i.name),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [conversations, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[highlight];
      if (hit) onSelect(hit.id);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-night-950/80 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-xl overflow-hidden !p-0">
        <div className="flex items-center gap-2 border-b border-night-700 px-3">
          <span className="text-zinc-500">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="input !border-0 !bg-transparent !px-0 !py-3 !text-sm !shadow-none"
            placeholder="Buscar por orçamento, cliente, telefone ou peça..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="ml-auto rounded border border-night-600 bg-night-800 px-1 font-mono text-[9px] text-zinc-400">
            Esc
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">
              Nenhum resultado para “{query}”.
            </p>
          )}
          {results.map((c, i) => {
            const match = c.quote?.code ?? null;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  i === highlight ? 'bg-brand/15' : 'hover:bg-night-800'
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-zinc-100">
                    {c.customerName || c.whatsappId}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-500">
                    {c.whatsappId}
                    {c.quote && c.quote.items.length > 0
                      ? ` · ${c.quote.items.slice(0, 2).map((i) => i.name).join(', ')}`
                      : ''}
                  </span>
                </span>
                {match && (
                  <span className="shrink-0 rounded bg-brand/15 px-1.5 font-mono text-[10px] text-brand">
                    {match}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
