'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toast } from 'sonner';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUSES, FUNNEL_STATUS_LABELS, FUNNEL_STATUS_PILL } from '@/lib/funnel';
import { DEPARTMENTS, DEPARTMENT_LABELS, DEPARTMENT_COLORS, isDepartment, type Department } from '@/lib/departments';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type LeadSource, type LostReason } from '@/lib/leads';
import { SystemHealthBadge } from '@/components/system-health';
import { CrmKanbanView } from '@/components/crm/CrmKanban';
import { CrmAnalytics } from '@/components/crm/CrmAnalytics';
import type { Agent, Conversation, QuoteSummary, TimelineEvent, Note } from '@/lib/crm-types';
import { fmtTime, fmtDate, statusPill, statusDot } from '@/lib/crm-types';

type ModuleId = 'funil' | 'atendimento' | 'pedidos' | 'bi';

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string | null;
  agentId: string | null;
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
  { id: 'bi', label: 'BI', hint: 'Métricas de vendas e conversão' },
];

function SendIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);

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
    setConversations(body.items ?? body.conversations ?? []);
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

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void refreshList();
      if (selectedId) void openConversation(selectedId);
    }, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshList, selectedId, openConversation]);

  async function openConversationInChat(id: string) {
    setModule('atendimento');
    await openConversation(id);
  }

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setTyping(true);
    try {
      const res = await fetch('/api/crm/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: selectedId, agentId: agentName || null, text: draft.trim() }),
      });
      if (res.ok) {
        setDraft('');
        await openConversation(selectedId);
        toast.success('Mensagem enviada');
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error('Falha ao enviar', { description: body.error ?? 'Erro desconhecido' });
      }
    } catch {
      toast.error('Falha ao enviar mensagem');
    } finally {
      setSending(false);
      setTimeout(() => setTyping(false), 1500);
    }
  }

  async function handoff(action: 'assume' | 'release') {
    if (!selectedId) return;
    if (action === 'assume' && !agentName.trim()) {
      toast.error('Informe seu nome para assumir o atendimento');
      return;
    }
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, agentId: agentName.trim() || undefined }),
    });
    if (res.ok) {
      toast.success(action === 'assume' ? 'Atendimento assumido' : 'Atendimento liberado para IA');
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao alternar atendimento', { description: body.error });
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
      toast.success('Status atualizado');
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao atualizar o funil', { description: body.error });
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
      toast.success('Lead marcado como perdido');
      await openConversation(id);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao marcar como perdido', { description: body.error });
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
      toast.success('Origem do lead salva');
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao salvar a origem', { description: body.error });
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
      toast.success('Anotação salva');
      await openConversation(selectedId);
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao salvar anotação', { description: body.error });
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
      toast.success('Departamento salvo');
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao atribuir departamento', { description: body.error });
    }
  }

  async function emitOrder(id: string) {
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'AGUARDANDO_NF' }),
    });
    if (res.ok) {
      toast.success('Pedido emitido — aguardando NF');
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error('Falha ao emitir pedido', { description: body.error });
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
    <div className="flex min-h-0 flex-col gap-3 p-4 lg:h-[calc(100vh-120px)] lg:p-5">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-50">Painel de Operações</h1>
            <p className="text-[11px] text-zinc-500">Visão unificada de vendas, atendimento e pedidos</p>
          </div>
          <nav className="flex rounded-lg border border-night-700/70 bg-night-800/40 p-0.5">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => setModule(m.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  module === m.id
                    ? 'bg-night-700 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost hidden items-center gap-2 !px-2.5 !py-1.5 !text-xs sm:flex"
            onClick={() => setPaletteOpen(true)}
            title="Busca rápida (Ctrl+K)"
          >
            <SearchIcon />
            <span>Buscar</span>
            <kbd className="rounded border border-night-600 bg-night-800 px-1 font-mono text-[9px] text-zinc-500">
              Ctrl+K
            </kbd>
          </button>
          <div className="relative">
            <input
              className="input w-44 !py-1.5 !text-xs"
              placeholder="Seu nome (agente)"
              value={agentName}
              onChange={(e) => {
                setAgentName(e.target.value);
                localStorage.setItem('crm-agent-name', e.target.value);
              }}
            />
            {agentName && (
              <span className="pointer-events-none absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand" />
            )}
          </div>
          <button className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => void refreshList()}>
            Atualizar
          </button>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 !text-xs ${autoRefresh ? 'text-emerald-400' : 'text-zinc-500'}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'Auto-refresh: 15s (clique para desativar)' : 'Auto-refresh desativado'}
          >
            {autoRefresh ? '● AO VIVO' : '○ PAUSADO'}
          </button>
          <SystemHealthBadge />
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          <span>{error}</span>
          <button
            className="rounded border border-red-900/60 px-1.5 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-900/40"
            onClick={() => setError(null)}
          >
            fechar
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          {[1, 2, 3].map((col) => (
            <div key={col} className="surface flex flex-col gap-2 p-3">
              <div className="skeleton h-5 w-24" />
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-lg border border-night-700/50 bg-night-800/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="skeleton h-2 w-2 shrink-0 rounded-full" />
                      <div className="skeleton h-3.5 w-28" />
                      <div className="skeleton ml-auto h-3 w-8" />
                    </div>
                    <div className="skeleton mt-1.5 h-3 w-36" />
                    <div className="skeleton mt-1 h-2.5 w-20" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : module === 'funil' ? (
        <CrmKanbanView
          conversations={conversations}
          agents={agents}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onOpen={openConversationInChat}
        />
      ) : module === 'atendimento' ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
          <div className="surface flex min-h-0 flex-col overflow-hidden !p-0">
            <div className="border-b border-night-700/70 p-2">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500">
                  <SearchIcon />
                </span>
                <input
                  className="input !py-1.5 !pl-8 !text-xs"
                  placeholder="Buscar conversa ou pedido..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
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
                <span className="tabular ml-auto shrink-0 text-[10px] text-zinc-500">
                  <span className="font-semibold text-zinc-300">{filtered.length}</span>/
                  {conversations.length}
                </span>
              </div>
            </div>
            <div className="scroll-slim min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
              {filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-zinc-500">
                  Nenhuma conversa encontrada.
                </p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void openConversation(c.id)}
                  className={`group w-full rounded-lg border px-2 py-1.5 text-left transition-all ${
                    selectedId === c.id
                      ? 'border-night-500 bg-night-800'
                      : 'border-transparent hover:bg-night-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(c.funnelStatus)}`} />
                      <span className="truncate text-xs font-semibold text-zinc-100">
                        {c.customerName || c.whatsappId}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {c.unreadCount > 0 && (
                        <span className="tabular rounded-full bg-red-500 px-1.5 py-px text-[9px] font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                      <span className="tabular text-[10px] text-zinc-500">
                        {fmtTime(c.lastMessageAt)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 pl-3 text-[10px]">
                    <span className="truncate text-zinc-500">{c.whatsappId}</span>
                    {c.department && (
                      <span className="chip text-zinc-500">
                        {DEPARTMENT_LABELS[c.department as Department] ?? c.department}
                      </span>
                    )}
                    {c.quote && (
                      <span className="ml-auto shrink-0 font-mono text-zinc-600">{c.quote.code}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1 pl-3 text-[10px]">
                    <span
                      className={`inline-flex items-center rounded-md px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                        c.humanMode
                          ? 'bg-brand/10 text-brand ring-brand/25'
                          : 'bg-sky-500/10 text-sky-300 ring-sky-500/25'
                      }`}
                    >
                      {c.humanMode ? `humano${c.assignedAgentId ? `:${c.assignedAgentId}` : ''}` : 'IA'}
                    </span>
                    {c.funnelStatus === 'ALTA_VALOR' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 text-[9px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-inset ring-rose-500/30">
                        <SparkIcon /> alto valor
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="surface flex min-h-0 flex-col overflow-hidden !p-0">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                Selecione uma conversa à esquerda.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-night-700/70 bg-night-900/80 px-3 py-2 backdrop-blur">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-zinc-100">
                        {selected.customerName || selected.whatsappId}
                      </h2>
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                          selected.humanMode
                            ? 'bg-brand/10 text-brand ring-brand/25'
                            : 'bg-sky-500/10 text-sky-300 ring-sky-500/25'
                        }`}
                      >
                        {selected.humanMode ? 'humano' : 'IA'}
                      </span>
                    </div>
                    <p className="truncate text-[10px] text-zinc-500">
                      {selected.whatsappId} · atualizado {fmtDate(selected.lastMessageAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
                  </div>
                </div>

                <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto bg-night-950/50 p-3">
                  {detail?.messages.length === 0 && (
                    <p className="py-10 text-center text-xs text-zinc-500">Sem mensagens ainda.</p>
                  )}
                  {detail?.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-xl px-3 py-1.5 text-xs shadow-card ${
                          m.direction === 'inbound'
                            ? 'rounded-tl-sm border border-night-700/70 bg-night-800/80 text-zinc-100'
                            : 'rounded-tr-sm border border-brand/25 bg-brand/15 text-zinc-50'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.text}</p>
                        <p
                          className={`mt-0.5 text-[9px] ${
                            m.direction === 'inbound' ? 'text-zinc-500' : 'text-brand/70'
                          }`}
                        >
                          {m.direction === 'inbound' ? 'cliente' : m.agentId ? m.agentId : 'IA'} ·{' '}
                          {fmtTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-night-700/70 bg-night-900/80 p-3 backdrop-blur">
                  {typing && (
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="flex gap-0.5">
                        <span className="h-1 w-1 animate-bounce rounded-full bg-brand/60 [animation-delay:0ms]" />
                        <span className="h-1 w-1 animate-bounce rounded-full bg-brand/60 [animation-delay:150ms]" />
                        <span className="h-1 w-1 animate-bounce rounded-full bg-brand/60 [animation-delay:300ms]" />
                      </span>
                      Enviando mensagem...
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      className="input !py-1.5 !text-xs"
                      placeholder="Mensagem para o cliente..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !sending) void sendMessage();
                      }}
                      disabled={sending}
                    />
                    <button
                      className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs"
                      disabled={!draft.trim() || sending}
                      onClick={() => void sendMessage()}
                    >
                      {sending ? '...' : <SendIcon />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="surface flex min-h-0 flex-col overflow-hidden !p-0">
            {!selected ? (
              <p className="p-4 text-xs text-zinc-500">Contexto do cliente aparecerá aqui.</p>
            ) : (
              <>
                <div className="flex gap-0.5 border-b border-night-700/70 bg-night-900/80 p-1.5 backdrop-blur">
                  <button
                    onClick={() => setSidebarTab('resumo')}
                    className={`flex-1 rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                      sidebarTab === 'resumo'
                        ? 'bg-night-700 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    Resumo
                  </button>
                  <button
                    onClick={() => setSidebarTab('anotacoes')}
                    className={`flex-1 rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                      sidebarTab === 'anotacoes'
                        ? 'bg-night-700 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    Anotações
                    {detail && detail.notes.length > 0 && (
                      <span className="tabular ml-1 rounded bg-night-800 px-1 text-[9px] text-zinc-400">
                        {detail.notes.length}
                      </span>
                    )}
                  </button>
                </div>
                {sidebarTab === 'resumo' ? (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
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
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
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
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
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
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
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
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
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
      ) : module === 'bi' ? (
        <CrmAnalytics conversations={conversations} />
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

function SparkIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
    </svg>
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
    <div className="mt-1.5 space-y-2 rounded-lg border border-night-700/70 bg-night-800/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-brand">{quote.code}</span>
        <span className="tabular text-[10px] text-zinc-500">{quote.items.length} itens</span>
      </div>
      <ul className="space-y-1 text-[11px] text-zinc-300">
        {quote.items.slice(0, 6).map((item, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">
              {item.quantity}x {item.name}
            </span>
            <span className="tabular shrink-0 text-zinc-400">
              {formatBRL(item.unitPriceCents * item.quantity)}
            </span>
          </li>
        ))}
        {quote.items.length > 6 && (
          <li className="text-[10px] text-zinc-500">+ {quote.items.length - 6} itens...</li>
        )}
      </ul>
      <dl className="divider space-y-0.5 pt-1.5 text-[11px]">
        <div className="flex justify-between">
          <dt className="text-zinc-500">Subtotal</dt>
          <dd className="tabular text-zinc-300">{formatBRL(quote.totalCents)}</dd>
        </div>
        <div className="flex justify-between text-brand">
          <dt>PIX</dt>
          <dd className="tabular">{formatBRL(quote.pixTotalCents)}</dd>
        </div>
        <div className="flex justify-between text-zinc-500">
          <dt>ou {quote.installments}x de</dt>
          <dd className="tabular">{formatBRL(quote.monthlyValueCents)}</dd>
        </div>
      </dl>
      {emitted ? (
        <p className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
          Pedido Bling #{quote.blingNumber}
          {quote.blingStatus ? ` · ${quote.blingStatus}` : ''} — emissão/expedição iniciada.
        </p>
      ) : status === 'AGUARDANDO_NF' ? (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/25">
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

      <div className="surface min-h-0 flex-1 overflow-auto !p-0">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="table-head">Código</th>
              <th className="table-head">Cliente</th>
              <th className="table-head">Origem</th>
              <th className="table-head">Atualizado</th>
              <th className="table-head text-right">Itens</th>
              <th className="table-head text-right">Total PIX</th>
              <th className="table-head text-right">Parcelado</th>
              <th className="table-head">Funil</th>
              <th className="table-head">Bling</th>
              <th className="table-head text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-zinc-500">
                  Nenhum pedido vinculado ainda. Os orçamentos confirmados pelo WhatsApp aparecem aqui.
                </td>
              </tr>
            )}
            {orders.map((c) => {
              const q = c.quote!;
              return (
                <tr
                  key={c.id}
                  className="border-b border-night-800/70 transition-colors hover:bg-night-800/40"
                >
                  <td className="px-3 py-2 font-mono font-semibold text-brand">{q.code}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-100">{c.customerName || c.whatsappId}</span>
                    <span className="block text-[10px] text-zinc-500">{c.whatsappId}</span>
                  </td>
                  <td className="px-3 py-2">
                    {q.utmSource ? (
                      <span className="inline-flex items-center rounded-md bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand ring-1 ring-inset ring-brand/25">
                        {q.utmSource}
                      </span>
                    ) : c.leadSource ? (
                      <span className="inline-flex items-center rounded-md bg-night-800 px-1.5 py-0.5 text-[10px] text-zinc-400 ring-1 ring-inset ring-night-600">
                        {LEAD_SOURCE_LABELS[c.leadSource as LeadSource] ?? c.leadSource}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-zinc-400">{fmtDate(c.lastMessageAt)}</td>
                  <td className="tabular px-3 py-2 text-right text-zinc-300">{q.items.length}</td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-brand">
                    {formatBRL(q.pixTotalCents)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-zinc-400">
                    {q.installments}x de {formatBRL(q.monthlyValueCents)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusPill(c.funnelStatus)}`}
                    >
                      {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-zinc-400">
                    {q.blingNumber ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
                        #{q.blingNumber}
                      </span>
                    ) : q.blingStatus ? (
                      <span className="text-zinc-500">{q.blingStatus}</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
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
    <div className="surface">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="tabular mt-0.5 text-xl font-bold tracking-tight text-zinc-50">{value}</p>
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
    <ol className="mt-1.5 space-y-3">
      {events.map((ev, i) => {
        const meta = TIMELINE_TYPE_META[ev.type] ?? { label: ev.type, color: 'bg-zinc-500' };
        const isLast = i === events.length - 1;
        return (
          <li key={ev.id} className="relative flex gap-2.5 pl-4">
            <span
              className={`absolute left-[3px] top-2.5 w-px bg-night-700/70 ${isLast ? 'h-0' : 'h-full'}`}
              aria-hidden
            />
            <span
              className={`absolute left-0 top-1 h-[7px] w-[7px] rounded-full ring-2 ring-night-900 ${meta.color}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold leading-tight text-zinc-200">{ev.title}</p>
              {ev.detail && (
                <p className="mt-0.5 text-[10px] leading-snug text-zinc-400">{ev.detail}</p>
              )}
              <p className="mt-1 text-[9px] text-zinc-500">
                <span className="chip text-zinc-500">{meta.label}</span>{' '}
                <span className="tabular">{fmtDate(ev.createdAt)}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/70 p-4 backdrop-blur-sm">
      <div className="surface w-full max-w-sm p-4 shadow-pop">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-50">Marcar como perdido</h3>
            <p className="mt-1 text-xs text-zinc-400">
              A conversa de <span className="font-semibold text-zinc-200">{customerName ?? '—'}</span>{' '}
              será movida para{' '}
              <span className="font-semibold text-red-300">Cancelado / Perdido</span>.
            </p>
          </div>
          <button
            className="rounded-md border border-night-700 px-1.5 text-[11px] text-zinc-500 transition-colors hover:border-night-500 hover:text-zinc-200"
            onClick={onCancel}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Motivo da perda
        </p>
        <div className="mt-1.5 space-y-1.5">
          {LOST_REASONS.map((r) => (
            <label
              key={r}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
                value === r
                  ? 'border-red-500/50 bg-red-950/30 text-red-200 ring-1 ring-inset ring-red-500/30'
                  : 'border-night-700 bg-night-800/50 text-zinc-300 hover:border-night-500'
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
      <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto">
        {notes.length === 0 && (
          <p className="py-6 text-center text-xs text-zinc-500">
            Nenhuma anotação ainda. Registre observações da negociação aqui.
          </p>
        )}
        {notes.map((n) => (
          <div
            key={n.id}
            className="rounded-lg border border-night-700/70 bg-night-800/50 p-2 transition-colors hover:border-night-600"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand">
                <span className="h-1 w-1 rounded-full bg-brand" />
                {n.agentId || 'Atendente'}
              </span>
              <span className="tabular text-[9px] text-zinc-500">{fmtDate(n.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-snug text-zinc-200">{n.text}</p>
          </div>
        ))}
      </div>
      <div className="divider mt-2 pt-2">
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-night-950/70 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="surface w-full max-w-xl overflow-hidden !p-0 shadow-pop">
        <div className="flex items-center gap-2.5 border-b border-night-700/70 px-3">
          <span className="text-zinc-500">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="input !border-0 !bg-transparent !px-0 !py-3 !text-sm !shadow-none !ring-0"
            placeholder="Buscar por orçamento, cliente, telefone ou peça..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="ml-auto rounded border border-night-600 bg-night-800 px-1 font-mono text-[9px] text-zinc-500">
            Esc
          </kbd>
        </div>
        <div className="scroll-slim max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">
              Nenhum resultado para "{query}".
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
                  i === highlight ? 'bg-night-700/70' : 'hover:bg-night-800/60'
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${statusDot(c.funnelStatus)}`}
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
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 font-mono text-[10px] text-brand ring-1 ring-inset ring-brand/25">
                    {match}
                  </span>
                )}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${statusPill(c.funnelStatus)}`}
                >
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
