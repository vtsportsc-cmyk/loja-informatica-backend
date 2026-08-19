'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Command,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  Search,
  UserCog,
} from 'lucide-react';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUS_LABELS } from '@/lib/funnel';
import { LEAD_SOURCE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type LeadSource, type LostReason } from '@/lib/leads';
import { formatPhoneBR } from '@/lib/phone';
import { SystemHealthBadge } from '@/components/system-health';
import { CrmKanbanView } from '@/components/crm/CrmKanban';
import { CrmAnalytics } from '@/components/crm/CrmAnalytics';
import { CrmDashboard, SegmentedControl } from '@/components/crm/CrmDashboard';
import { CrmWorkstation, type ConversationDetail } from '@/components/crm/CrmWorkstation';
import type { Agent, Conversation } from '@/lib/crm-types';
import { fmtDate, statusPill, statusDot } from '@/lib/crm-types';

type ModuleId = 'funil' | 'atendimento' | 'pedidos' | 'bi';
type CrmView = 'workstation' | 'dashboard';

const MODULES: Array<{ id: ModuleId; label: string; hint: string }> = [
  { id: 'funil', label: 'Funil de Vendas', hint: 'Kanban de leads' },
  { id: 'atendimento', label: 'Atendimento', hint: 'Workstation 3 colunas' },
  { id: 'pedidos', label: 'Pedidos', hint: 'Orçamentos e emissão' },
  { id: 'bi', label: 'BI', hint: 'Métricas de vendas e conversão' },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CrmPage() {
  const [module, setModule] = useState<ModuleId>('funil');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [agentName, setAgentName] = useState('');
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
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
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [crmView, setCrmView] = useState<CrmView>('workstation');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAgentName(localStorage.getItem('crm-agent-name') ?? '');
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/conversations');
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'falha ao listar conversas');
        return;
      }
      setConversations(body.items ?? body.conversations ?? []);
    } catch {
      setError('falha ao listar conversas (rede)');
    } finally {
      setLoading(false);
    }
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
    setShowQuickReplies(false);
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

  useEffect(() => {
    if (detail?.messages && detail.messages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [detail?.messages]);

  async function openConversationInChat(id: string) {
    setModule('atendimento');
    await openConversation(id);
  }

  /** Abre a workstation, mas gate por operador: sem nome selecionado, pede identificacao antes. */
  function enterAtendimento() {
    if (!agentName.trim()) {
      setOperatorModalOpen(true);
      return;
    }
    setModule('atendimento');
  }

  function selectOperator(name: string) {
    setAgentName(name);
    localStorage.setItem('crm-agent-name', name);
    setOperatorModalOpen(false);
    setModule('atendimento');
  }

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setTyping(true);
    setShowQuickReplies(false);
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
      {/* ─── Top Bar ─── */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 !rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-50">Painel de Operações</h1>
            <p className="text-[11px] text-zinc-500">
              {module === 'atendimento' && crmView === 'dashboard'
                ? 'Dashboard gerencial — visão executiva'
                : 'Workstation de atendimento multi-atendente'}
            </p>
          </div>
          <nav className="flex rounded-lg border border-zinc-800/60 bg-night-800/40 p-0.5">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => (m.id === 'atendimento' ? enterAtendimento() : setModule(m.id))}
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
          {module === 'atendimento' && (
            <SegmentedControl
              value={crmView}
              onChange={setCrmView}
              options={[
                { value: 'workstation', label: 'Workstation', icon: <MessageSquare className="h-3 w-3" strokeWidth={2} /> },
                { value: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-3 w-3" strokeWidth={2} /> },
              ]}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost hidden items-center gap-2 !border-zinc-800/60 !px-2.5 !py-1.5 !text-xs sm:flex"
            onClick={() => setPaletteOpen(true)}
            title="Busca rápida (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Buscar</span>
            <kbd className="flex items-center gap-0.5 rounded border border-night-600 bg-night-800 px-1 font-mono text-[9px] text-zinc-500">
              <Command className="h-2.5 w-2.5" strokeWidth={2.5} />K
            </kbd>
          </button>
          <OperatorBadge name={agentName} onChange={() => setOperatorModalOpen(true)} />
          <button className="btn-ghost !border-zinc-800/60 !px-2.5 !py-1.5 !text-xs" onClick={() => void refreshList()} title="Atualizar lista">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            className={`btn-ghost inline-flex items-center gap-1.5 !border-zinc-800/60 !px-2.5 !py-1.5 !text-xs ${autoRefresh ? 'text-emerald-400' : 'text-zinc-500'}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'Auto-refresh: 15s' : 'Auto-refresh desativado'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? 'status-ring-online bg-emerald-400' : 'bg-zinc-600'}`} />
            {autoRefresh ? 'AO VIVO' : 'PAUSADO'}
          </button>
          <SystemHealthBadge />
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          <span>{error}</span>
          <button className="rounded border border-red-900/60 px-1.5 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-900/40" onClick={() => setError(null)}>fechar</button>
        </div>
      )}

      {/* ─── Content ─── */}
      {loading ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          {[1, 2, 3].map((col) => (
            <div key={col} className="surface flex flex-col gap-2 p-3">
              <div className="skeleton h-5 w-24" />
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-lg border border-night-700/50 bg-night-800/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <div className="skeleton h-3.5 w-28" />
                        <div className="skeleton h-2.5 w-20" />
                      </div>
                      <div className="skeleton h-3 w-8" />
                    </div>
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
        crmView === 'dashboard' ? (
          <CrmDashboard conversations={conversations} agents={agents} />
        ) : (
          <CrmWorkstation
            conversations={conversations}
            filtered={filtered}
            agents={agents}
            selectedId={selectedId}
            detail={detail}
            operatorName={agentName}
            search={search}
            onSearchChange={setSearch}
            departmentFilter={departmentFilter}
            onDepartmentFilterChange={setDepartmentFilter}
            onOpenConversation={(id) => void openConversation(id)}
            draft={draft}
            onDraftChange={setDraft}
            sending={sending}
            typing={typing}
            onSendMessage={() => void sendMessage()}
            showQuickReplies={showQuickReplies}
            onToggleQuickReplies={() => setShowQuickReplies((v) => !v)}
            onSelectQuickReply={(text) => {
              setDraft(text);
              setShowQuickReplies(false);
            }}
            onHandoff={(action) => void handoff(action)}
            chatEndRef={chatEndRef}
            sidebarTab={sidebarTab}
            onSidebarTabChange={setSidebarTab}
            statusDraft={statusDraft}
            onStatusDraftChange={setStatusDraft}
            onChangeStatus={() => void changeStatus()}
            departmentDraft={departmentDraft}
            onDepartmentDraftChange={setDepartmentDraft}
            agentDraft={agentDraft}
            onAgentDraftChange={setAgentDraft}
            onSaveDepartment={() => void saveDepartment()}
            leadSourceDraft={leadSourceDraft}
            onLeadSourceDraftChange={setLeadSourceDraft}
            onSaveLeadSource={() => void saveLeadSource()}
            noteDraft={noteDraft}
            onNoteDraftChange={setNoteDraft}
            onSaveNote={() => void saveNote()}
            onEmitOrder={(id) => void emitOrder(id)}
          />
        )
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

      {/* Modals */}
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

      {operatorModalOpen && (
        <OperatorModal
          agents={agents}
          current={agentName}
          onSelect={selectOperator}
          onClose={() => setOperatorModalOpen(false)}
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

// ---------------------------------------------------------------------------
// OperatorBadge — identificacao do vendedor ativo na topbar
// ---------------------------------------------------------------------------

function OperatorBadge({ name, onChange }: { name: string; onChange: () => void }) {
  if (!name.trim()) {
    return (
      <button
        onClick={onChange}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
      >
        <UserCog className="h-3.5 w-3.5" strokeWidth={2} />
        Selecionar operador
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-night-800/40 px-2.5 py-1.5 text-xs">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">
        {name.trim().slice(0, 2).toUpperCase()}
      </span>
      <span className="text-zinc-400">
        Atendendo como <span className="font-semibold text-zinc-100">{name}</span>
      </span>
      <button onClick={onChange} className="font-semibold text-brand hover:underline">
        Alterar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperatorModal — selecao/cadastro rapido do vendedor ativo (gate da workstation)
// ---------------------------------------------------------------------------

function OperatorModal({
  agents,
  current,
  onSelect,
  onClose,
}: {
  agents: Agent[];
  current: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(current);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass w-full max-w-md !rounded-2xl p-5 shadow-pop">
        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-50">
          <UserCog className="h-4 w-4 text-brand" strokeWidth={2} />
          Quem está atendendo?
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Selecione seu nome na lista ou cadastre rapidamente para liberar a workstation.
        </p>

        {agents.length > 0 && (
          <div className="mt-4 grid max-h-52 grid-cols-2 gap-2 overflow-y-auto scroll-slim pr-0.5">
            {agents.map((a) => {
              const active = a.name === current;
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a.name)}
                  className={`relative rounded-lg border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-brand/50 bg-brand/10'
                      : 'border-zinc-800/60 bg-night-800/40 hover:border-brand/30 hover:bg-night-800'
                  }`}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                    {a.name.slice(0, 2).toUpperCase()}
                  </div>
                  <p className="mt-1.5 truncate text-xs font-semibold text-zinc-100">{a.name}</p>
                  {a.role && <p className="text-[10px] text-zinc-500">{a.role}</p>}
                  {active && <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-brand" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
        )}

        <div className="divider mt-4 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Ou cadastro rápido</p>
          <div className="mt-1.5 flex gap-2">
            <input
              autoFocus
              className="input !text-xs"
              placeholder="Seu nome"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) onSelect(draft.trim());
              }}
            />
            <button
              className="btn-primary shrink-0 !px-3 !text-xs"
              disabled={!draft.trim()}
              onClick={() => onSelect(draft.trim())}
            >
              Entrar
            </button>
          </div>
        </div>

        <button className="btn-ghost mt-4 w-full !border-zinc-800/60 !text-xs" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrdersTable
// ---------------------------------------------------------------------------

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
                  Nenhum pedido vinculado ainda.
                </td>
              </tr>
            )}
            {orders.map((c) => {
              const q = c.quote!;
              return (
                <tr key={c.id} className="border-b border-night-800/70 transition-colors hover:bg-night-800/40">
                  <td className="px-3 py-2 font-mono font-semibold text-brand">{q.code}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-100">{c.customerName || c.whatsappId}</span>
                    <span className="block text-[10px] text-zinc-500">{c.whatsappId}</span>
                  </td>
                  <td className="px-3 py-2">
                    {q.utmSource ? (
                      <span className="inline-flex items-center rounded-md bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand ring-1 ring-inset ring-brand/25">{q.utmSource}</span>
                    ) : c.leadSource ? (
                      <span className="inline-flex items-center rounded-md bg-night-800 px-1.5 py-0.5 text-[10px] text-zinc-400 ring-1 ring-inset ring-night-600">{LEAD_SOURCE_LABELS[c.leadSource as LeadSource] ?? c.leadSource}</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-zinc-400">{fmtDate(c.lastMessageAt)}</td>
                  <td className="tabular px-3 py-2 text-right text-zinc-300">{q.items.length}</td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-brand">{formatBRL(q.pixTotalCents)}</td>
                  <td className="tabular px-3 py-2 text-right text-zinc-400">{q.installments}x de {formatBRL(q.monthlyValueCents)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusPill(c.funnelStatus)}`}>
                      {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-zinc-400">
                    {q.blingNumber ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/25">#{q.blingNumber}</span>
                    ) : q.blingStatus ? (
                      <span className="text-zinc-500">{q.blingStatus}</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost !px-2 !py-1 !text-[10px]" onClick={() => onOpen(c.id)}>Conversa</button>
                      {!q.blingNumber && c.funnelStatus !== 'AGUARDANDO_NF' && (
                        <button className="btn-primary !px-2 !py-1 !text-[10px]" onClick={() => onEmit(c.id)}>Emitir</button>
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

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="tabular mt-0.5 text-xl font-bold tracking-tight text-zinc-50">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LostReasonModal
// ---------------------------------------------------------------------------

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
              A conversa de <span className="font-semibold text-zinc-200">{customerName ?? '—'}</span> será movida para <span className="font-semibold text-red-300">Cancelado / Perdido</span>.
            </p>
          </div>
          <button className="rounded-md border border-night-700 px-1.5 text-[11px] text-zinc-500 transition-colors hover:border-night-500 hover:text-zinc-200" onClick={onCancel} aria-label="Fechar">✕</button>
        </div>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Motivo da perda</p>
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
              <input type="radio" name="lost-reason" className="accent-red-500" checked={value === r} onChange={() => onChange(r)} />
              {LOST_REASON_LABELS[r]}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={onConfirm}>Confirmar perda</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandPalette
// ---------------------------------------------------------------------------

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
        const haystack = [c.customerName ?? '', c.whatsappId, c.quote?.code ?? '', ...(c.quote?.items ?? []).map((i) => i.name)].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [conversations, query]);

  useEffect(() => { setHighlight(0); }, [query]);

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-night-950/70 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass w-full max-w-xl overflow-hidden !rounded-2xl !p-0 shadow-pop">
        <div className="flex items-center gap-2.5 border-b border-zinc-800/60 px-3">
          <span className="text-zinc-500"><Search className="h-4 w-4" strokeWidth={2} /></span>
          <input
            ref={inputRef}
            className="input !border-0 !bg-transparent !px-0 !py-3 !text-sm !shadow-none !ring-0"
            placeholder="Buscar por orçamento, cliente, telefone ou peça..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="ml-auto rounded border border-night-600 bg-night-800 px-1 font-mono text-[9px] text-zinc-500">Esc</kbd>
        </div>
        <div className="scroll-slim max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">Nenhum resultado para &quot;{query}&quot;.</p>
          )}
          {results.map((c, i) => {
            const match = c.quote?.code ?? null;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${i === highlight ? 'bg-night-700/70' : 'hover:bg-night-800/60'}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(c.funnelStatus)}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-zinc-100">{c.customerName || c.whatsappId}</span>
                  <span className="block truncate text-[10px] text-zinc-500">
                    {formatPhoneBR(c.whatsappId)}
                    {c.quote && c.quote.items.length > 0 ? ` · ${c.quote.items.slice(0, 2).map((i) => i.name).join(', ')}` : ''}
                  </span>
                </span>
                {match && (
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 font-mono text-[10px] text-brand ring-1 ring-inset ring-brand/25">{match}</span>
                )}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${statusPill(c.funnelStatus)}`}>
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
