'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  Box,
  CircleCheckBig,
  CircuitBoard,
  Command,
  Copy,
  Cpu,
  Fan,
  Gpu,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  MessageSquare,
  Monitor,
  Package,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Tag,
  Zap,
} from 'lucide-react';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUSES, FUNNEL_STATUS_LABELS } from '@/lib/funnel';
import { DEPARTMENTS, DEPARTMENT_LABELS, DEPARTMENT_COLORS, isDepartment, type Department } from '@/lib/departments';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type LeadSource, type LostReason } from '@/lib/leads';
import { formatPhoneBR } from '@/lib/phone';
import { SystemHealthBadge } from '@/components/system-health';
import { CrmKanbanView } from '@/components/crm/CrmKanban';
import { CrmAnalytics } from '@/components/crm/CrmAnalytics';
import { CrmDashboard, SegmentedControl } from '@/components/crm/CrmDashboard';
import type { Agent, Conversation, QuoteSummary, TimelineEvent, Note } from '@/lib/crm-types';
import { fmtTime, fmtDate, statusPill, statusDot } from '@/lib/crm-types';

type ModuleId = 'funil' | 'atendimento' | 'pedidos' | 'bi';
type CrmView = 'workstation' | 'dashboard';

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
  { id: 'atendimento', label: 'Atendimento', hint: 'Workstation 3 colunas' },
  { id: 'pedidos', label: 'Pedidos', hint: 'Orçamentos e emissão' },
  { id: 'bi', label: 'BI', hint: 'Métricas de vendas e conversão' },
];

const QUICK_REPLIES = [
  { label: 'Olá! Como posso ajudar?', text: 'Olá! 👋 Como posso ajudar você hoje?' },
  { label: 'Aguardando confirmação', text: 'Estou aguardando sua confirmação. Qualquer dúvida, estou à disposição!' },
  { label: 'Orçamento disponível', text: 'Seu orçamento está pronto! Confira os detalhes e me avise se deseja prosseguir.' },
  { label: 'PIX gerado', text: 'O PIX foi gerado! Verifique os dados de pagamento no link do orçamento.' },
  { label: 'Agradecimento', text: 'Obrigado pela preferência! Se precisar de algo mais, é só chamar. 🙌' },
];

function getInitials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-2).padStart(2, '0');
}

function statusBadge(c: Conversation): { label: string; cls: string } {
  if (c.funnelStatus === 'PIX_GERADO') return { label: 'Pagamento Pendente PIX', cls: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30' };
  if (c.humanMode && c.assignedAgentId) return { label: 'Transbordo Humano', cls: 'bg-brand/15 text-brand ring-brand/25' };
  if (c.humanMode) return { label: 'Humano', cls: 'bg-brand/15 text-brand ring-brand/25' };
  if (c.funnelStatus === 'ALTA_VALOR') return { label: 'Alto Valor', cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' };
  if (c.funnelStatus === 'CARRINHO') return { label: 'No Carrinho', cls: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' };
  if (c.funnelStatus === 'MONTANDO_PC') return { label: 'Montando PC', cls: 'bg-blue-500/15 text-blue-300 ring-blue-500/30' };
  if (c.funnelStatus === 'EM_QUALIFICACAO') return { label: 'Em Qualificação', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' };
  if (c.unreadCount > 0) return { label: 'Aguardando IA', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' };
  return { label: 'IA Ativo', cls: 'bg-sky-500/15 text-sky-300 ring-sky-500/25' };
}

const AVATAR_COLORS = [
  'bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-brand', 'bg-pink-600',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Anel de presenca do avatar, derivado do `lastMessageAt` real da conversa
 * (o WhatsApp nao expoe presence online/offline via webhook): verde pulsante
 * para atividade nos ultimos 5min, ambar para a ultima hora, cinza p/ o resto.
 */
function presenceRing(lastMessageAt: string | null): { dot: string; pulse: boolean; label: string } {
  if (!lastMessageAt) return { dot: 'bg-zinc-600', pulse: false, label: 'Sem atividade recente' };
  const diff = Date.now() - new Date(lastMessageAt).getTime();
  if (diff < 5 * 60 * 1000) return { dot: 'bg-emerald-400', pulse: true, label: 'Ativo agora' };
  if (diff < 60 * 60 * 1000) return { dot: 'bg-amber-400', pulse: false, label: 'Ativo na última hora' };
  return { dot: 'bg-zinc-600', pulse: false, label: 'Inativo' };
}

/** Mapeia o nome do item do orcamento para um icone tecnico (heuristica por palavra-chave). */
function partIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  const cls = 'h-3.5 w-3.5';
  if (/(rtx|gtx|radeon|placa de v[ií]deo|geforce)/.test(n)) return <Gpu className={cls} strokeWidth={2} />;
  if (/(ryzen|intel core|i[3579]-|processador)/.test(n)) return <Cpu className={cls} strokeWidth={2} />;
  if (/(mem[oó]ria|\bram\b|ddr[345])/.test(n)) return <MemoryStick className={cls} strokeWidth={2} />;
  if (/(ssd|nvme|\bhd\b|armazenamento|disco)/.test(n)) return <HardDrive className={cls} strokeWidth={2} />;
  if (/(fonte|\bpsu\b|\bfnte\b)/.test(n)) return <Zap className={cls} strokeWidth={2} />;
  if (/(gabinete|\bcase\b)/.test(n)) return <Box className={cls} strokeWidth={2} />;
  if (/(water\s?cooler|\bcooler\b|\bfan\b)/.test(n)) return <Fan className={cls} strokeWidth={2} />;
  if (/(placa[- ]m[ãa]e|motherboard)/.test(n)) return <CircuitBoard className={cls} strokeWidth={2} />;
  if (/(monitor)/.test(n)) return <Monitor className={cls} strokeWidth={2} />;
  return <Package className={cls} strokeWidth={2} />;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

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
          <div className="relative">
            <input
              className="input w-44 !border-zinc-800/60 !py-1.5 !text-xs"
              placeholder="Seu nome (agente)"
              value={agentName}
              onChange={(e) => {
                setAgentName(e.target.value);
                localStorage.setItem('crm-agent-name', e.target.value);
              }}
            />
            {agentName && <span className="pointer-events-none absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand" />}
          </div>
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
        /* ═══════════════════════════════════════════════════════════════
           WORKSTATION 3 COLUNAS
           ═══════════════════════════════════════════════════════════════ */
        <div className="glass grid min-h-0 flex-1 gap-0 overflow-hidden !rounded-xl lg:grid-cols-[320px_minmax(0,1fr)_340px]">

          {/* ── COLUNA 1: Conversas & Filtros ── */}
          <div className="flex min-h-0 flex-col border-r border-zinc-800/50 bg-night-900/50">
            {/* Search + Filters */}
            <div className="border-b border-zinc-800/50 p-2.5">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500">
                  <Search className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <input
                  className="input !border-zinc-800/60 !py-1.5 !pl-8 !pr-12 !text-xs"
                  placeholder="Buscar por nome, telefone ou orçamento..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded border border-night-600 bg-night-800/80 px-1 font-mono text-[9px] text-zinc-500">
                  <Command className="h-2.5 w-2.5" strokeWidth={2.5} />K
                </kbd>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <select
                  className="select !border-zinc-800/60 !py-1 !text-[11px]"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  <option value="sem-departamento">Sem fila</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                  ))}
                </select>
                <span className="tabular ml-auto shrink-0 text-[10px] text-zinc-500">
                  <span className="font-semibold text-zinc-300">{filtered.length}</span>/{conversations.length}
                </span>
              </div>
            </div>

            {/* Conversation List */}
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-zinc-500">Nenhuma conversa encontrada.</p>
              )}
              {filtered.map((c) => {
                const badge = statusBadge(c);
                const presence = presenceRing(c.lastMessageAt);
                return (
                  <button
                    key={c.id}
                    onClick={() => void openConversation(c.id)}
                    className={`group flex w-full items-start gap-2.5 border-b border-zinc-800/40 px-3 py-2.5 text-left transition-all ${
                      selectedId === c.id
                        ? 'border-l-2 border-l-brand bg-night-800/60'
                        : 'border-l-2 border-l-transparent hover:bg-night-800/30'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(c.id)}`}>
                        {getInitials(c.customerName, c.whatsappId)}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-night-900 ${presence.dot} ${presence.pulse ? 'status-ring-online' : ''}`} title={presence.label} />
                      {c.unreadCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white ring-2 ring-night-900">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-semibold text-zinc-100">
                          {c.customerName || 'Sem nome'}
                        </span>
                        <span className="tabular shrink-0 text-[10px] text-zinc-500">{fmtTime(c.lastMessageAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                        {formatPhoneBR(c.whatsappId)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ring-1 ring-inset ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {c.department && (
                          <span className="chip !border-zinc-800/60 !py-px !text-[8px]">{DEPARTMENT_LABELS[c.department as Department] ?? c.department}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── COLUNA 2: Chat Ativo & Ações Rápidas ── */}
          <div className="flex min-h-0 flex-col bg-night-950/30">
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-800/50 bg-night-800/30">
                  <MessageSquare className="h-7 w-7 text-zinc-600" strokeWidth={1.75} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-zinc-400">Nenhuma conversa selecionada</p>
                  <p className="mt-1 text-xs text-zinc-600">Selecione uma conversa na coluna ao lado para iniciar o atendimento.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Chat Header */}
                <div className="flex items-center justify-between gap-2 border-b border-zinc-800/50 bg-night-900/80 px-4 py-2.5 backdrop-blur">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(selected.id)}`}>
                        {getInitials(selected.customerName, selected.whatsappId)}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-night-900 ${presenceRing(selected.lastMessageAt).dot}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-zinc-100">
                          {selected.customerName || 'Sem nome'}
                        </h2>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ring-1 ring-inset ${statusBadge(selected).cls}`}>
                          {statusBadge(selected).label}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-zinc-500">
                        {formatPhoneBR(selected.whatsappId)} · {fmtDate(selected.lastMessageAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {selected.humanMode ? (
                      <button
                        className="btn-ghost !border-zinc-800/60 !px-2.5 !py-1 !text-[11px]"
                        onClick={() => void handoff('release')}
                        title="Liberar para a IA"
                      >
                        <Bot className="h-3 w-3" strokeWidth={2} /> Liberar p/ IA
                      </button>
                    ) : (
                      <button
                        className="btn-primary !px-2.5 !py-1 !text-[11px]"
                        onClick={() => void handoff('assume')}
                        title="Assumir atendimento"
                      >
                        Assumir (humano)
                      </button>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                  {detail?.messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800/50 bg-night-800/30">
                        <MessageSquare className="h-5 w-5 text-zinc-600" strokeWidth={1.75} />
                      </div>
                      <p className="mt-3 text-xs text-zinc-500">Sem mensagens ainda.</p>
                    </div>
                  )}
                  {detail?.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs shadow-sm shadow-black/10 ${
                          m.direction === 'inbound'
                            ? 'rounded-tl-md border border-zinc-800/60 bg-night-800/80 text-zinc-100'
                            : 'rounded-tr-md border border-brand/20 bg-gradient-to-br from-brand/15 to-brand/5 text-zinc-50'
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                        <p className={`mt-1 text-[9px] ${m.direction === 'inbound' ? 'text-zinc-500' : 'text-brand/70'}`}>
                          {m.direction === 'inbound' ? 'cliente' : m.agentId ? m.agentId : 'IA'} ·{' '}
                          {fmtTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {typing && (
                    <div className="flex justify-end">
                      <div className="flex items-center gap-1 rounded-2xl rounded-tr-md border border-brand/20 bg-brand/10 px-3 py-2.5">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/70 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/70 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/70 [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Quick Actions Bar */}
                {selected && (
                  <div className="border-t border-zinc-800/50 bg-night-900/60 px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-violet-300 transition-colors hover:bg-violet-500/20"
                        title="Enviar link do orçamento"
                        onClick={() => {
                          if (selected.quote) {
                            const url = `${window.location.origin}/quote/${selected.quote.code}`;
                            navigator.clipboard.writeText(url).then(
                              () => toast.success('Link copiado!', { description: url }),
                              () => toast.error('Falha ao copiar'),
                            );
                          } else {
                            toast.info('Conversa sem orçamento vinculado');
                          }
                        }}
                      >
                        <Copy className="h-3 w-3" strokeWidth={2} /> Orçamento
                      </button>
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20"
                        title="Alternar Robô / Humano"
                        onClick={() => void handoff(selected.humanMode ? 'release' : 'assume')}
                      >
                        <Bot className="h-3 w-3" strokeWidth={2} /> {selected.humanMode ? 'Liberar IA' : 'Assumir'}
                      </button>
                      <button
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                          showQuickReplies
                            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                            : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        }`}
                        title="Respostas rápidas"
                        onClick={() => setShowQuickReplies(!showQuickReplies)}
                      >
                        <Tag className="h-3 w-3" strokeWidth={2} /> Templates
                      </button>
                    </div>
                    {showQuickReplies && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {QUICK_REPLIES.map((qr, i) => (
                          <button
                            key={i}
                            className="rounded-md border border-night-600 bg-night-800/60 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:border-night-500 hover:bg-night-800 hover:text-white"
                            onClick={() => {
                              setDraft(qr.text);
                              setShowQuickReplies(false);
                            }}
                          >
                            {qr.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Input */}
                <div className="border-t border-zinc-800/50 bg-night-900/80 p-3 backdrop-blur">
                  <div className="flex gap-2">
                    <input
                      className="input !border-zinc-800/60 !py-1.5 !text-xs"
                      placeholder="Digite sua mensagem..."
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
                      {sending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Send className="h-3.5 w-3.5" strokeWidth={2} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── COLUNA 3: Ficha do Lead / Contexto ── */}
          <div className="flex min-h-0 flex-col border-l border-zinc-800/50 bg-night-900/50">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-zinc-500">
                Selecione uma conversa para ver os dados do lead.
              </div>
            ) : (
              <>
                {/* Client Card Header */}
                <div className="border-b border-zinc-800/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(selected.id)}`}>
                      {getInitials(selected.customerName, selected.whatsappId)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-zinc-50">
                        {selected.customerName || 'Sem nome'}
                      </h3>
                      <p className="text-[11px] text-zinc-500">{formatPhoneBR(selected.whatsappId)}</p>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-0.5 border-b border-zinc-800/50 bg-night-900/40 p-1.5">
                  <button
                    onClick={() => setSidebarTab('resumo')}
                    className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                      sidebarTab === 'resumo' ? 'bg-night-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    Ficha
                  </button>
                  <button
                    onClick={() => setSidebarTab('anotacoes')}
                    className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                      sidebarTab === 'anotacoes' ? 'bg-night-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    Anotações
                    {detail && detail.notes.length > 0 && (
                      <span className="tabular ml-1 rounded bg-night-800 px-1 text-[9px] text-zinc-400">{detail.notes.length}</span>
                    )}
                  </button>
                </div>

                {sidebarTab === 'resumo' ? (
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    {/* Status do Funil */}
                    <Section title="Status do Funil">
                      <div className="mt-1.5 flex items-center gap-2">
                        <select
                          className="select !py-1.5 !text-xs"
                          value={statusDraft}
                          onChange={(e) => setStatusDraft(e.target.value)}
                        >
                          {FUNNEL_STATUSES.map((s) => (
                            <option key={s} value={s}>{FUNNEL_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        <button className="btn-ghost shrink-0 !px-2 !py-1 !text-[11px]" onClick={() => void changeStatus()}>Salvar</button>
                      </div>
                      {selected.funnelStatus === 'CANCELADO' && (
                        <p className="mt-1.5 rounded bg-red-950/60 px-2 py-1 text-[10px] text-red-300">
                          Perdido{selected.lostReason ? ` — ${LOST_REASON_LABELS[selected.lostReason as LostReason] ?? selected.lostReason}` : ''}
                          {selected.lostAt ? ` · ${fmtDate(selected.lostAt)}` : ''}
                        </p>
                      )}
                    </Section>

                    {/* Atribuição */}
                    <Section title="Atribuição">
                      <div className="mt-1.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <select className="select !py-1.5 !text-xs" value={departmentDraft} onChange={(e) => setDepartmentDraft(e.target.value)}>
                            <option value="none">Sem departamento</option>
                            {DEPARTMENTS.map((d) => (
                              <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                            ))}
                          </select>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${departmentDraft !== 'none' && isDepartment(departmentDraft) ? DEPARTMENT_COLORS[departmentDraft as Department] : 'bg-zinc-500'}`} />
                        </div>
                        <div className="flex items-center gap-2">
                          <select className="select !py-1.5 !text-xs" value={agentDraft} onChange={(e) => setAgentDraft(e.target.value)}>
                            <option value="none">Nenhum atendente</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${a.role}` : ''}</option>
                            ))}
                          </select>
                          <button className="btn-ghost shrink-0 !px-2 !py-1 !text-[11px]" onClick={() => void saveDepartment()}>Salvar</button>
                        </div>
                      </div>
                    </Section>

                    {/* Origem do Lead */}
                    <Section title="Origem do Lead">
                      <div className="mt-1.5 flex items-center gap-2">
                        <select className="select !py-1.5 !text-xs" value={leadSourceDraft} onChange={(e) => setLeadSourceDraft(e.target.value)}>
                          <option value="none">Sem origem</option>
                          {LEAD_SOURCES.map((s) => (
                            <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
                          ))}
                        </select>
                        <button className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => void saveLeadSource()}>Salvar</button>
                      </div>
                    </Section>

                    {/* Setup montado (Monte seu PC) / Orçamento */}
                    <Section title="Setup Montado · PC Gamer">
                      {selected.quote ? (
                        <WorkstationOrderSummary
                          quote={selected.quote}
                          status={selected.funnelStatus}
                          onEmit={() => void emitOrder(selected.id)}
                        />
                      ) : (
                        <p className="mt-1.5 text-xs text-zinc-500">Nenhum orçamento vinculado.</p>
                      )}
                    </Section>

                    {/* Timeline */}
                    <Section title="Timeline">
                      <Timeline events={detail?.timeline ?? []} />
                    </Section>
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
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkstationOrderSummary — card tecnico do setup montado (Col 3, "PC Gamer")
// ---------------------------------------------------------------------------

function WorkstationOrderSummary({
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
    <div className="mt-1.5 space-y-3 overflow-hidden rounded-xl border border-zinc-800/60 bg-gradient-to-b from-night-800/60 to-night-800/30 p-3 shadow-sm shadow-black/10">
      {/* Header: codigo + badge de compatibilidade */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-brand">{quote.code}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
          <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
          Compatível
        </span>
      </div>

      {/* Setup — lista tecnica de pecas */}
      <ul className="space-y-1.5">
        {quote.items.slice(0, 6).map((item, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg border border-zinc-800/40 bg-night-900/40 px-2 py-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-night-800 text-zinc-400">
              {partIcon(item.name)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">
              {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
            </span>
            <span className="tabular shrink-0 text-[10px] text-zinc-500">{formatBRL(item.unitPriceCents * item.quantity)}</span>
          </li>
        ))}
        {quote.items.length > 6 && (
          <li className="px-1 text-[10px] text-zinc-500">+ {quote.items.length - 6} itens...</li>
        )}
      </ul>

      {/* Totals */}
      <dl className="divider space-y-0.5 pt-2 text-[11px]">
        <div className="flex justify-between">
          <dt className="text-zinc-500">Subtotal</dt>
          <dd className="tabular text-zinc-300">{formatBRL(quote.totalCents)}</dd>
        </div>
        <div className="flex justify-between text-zinc-500">
          <dt>ou {quote.installments}x de</dt>
          <dd className="tabular">{formatBRL(quote.monthlyValueCents)}</dd>
        </div>
      </dl>

      {/* Cobrança PIX — proeminente */}
      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-3 py-2.5 text-xs font-bold text-night-950 shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.01] active:scale-[0.99]"
        onClick={() => {
          toast.info('Cobrança PIX', {
            description: `PIX de ${formatBRL(quote.pixTotalCents)} — código: ${quote.code}`,
          });
        }}
      >
        <QrCode className="h-4 w-4" strokeWidth={2.25} />
        Cobrar PIX · {formatBRL(quote.pixTotalCents)}
      </button>

      <button
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800/60 bg-night-900/40 px-2 py-1.5 text-[10px] font-semibold text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        onClick={() => {
          const url = `${window.location.origin}/quote/${quote.code}`;
          navigator.clipboard.writeText(url).then(
            () => toast.success('Link copiado!', { description: url }),
            () => toast.error('Falha ao copiar link'),
          );
        }}
      >
        <Copy className="h-3 w-3" strokeWidth={2} /> Copiar link do orçamento
      </button>

      {/* Bling Status */}
      {emitted ? (
        <p className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
          <CircleCheckBig className="h-3 w-3 shrink-0" strokeWidth={2} />
          Pedido Bling #{quote.blingNumber}{quote.blingStatus ? ` · ${quote.blingStatus}` : ''}
        </p>
      ) : status === 'AGUARDANDO_NF' ? (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/25">
          Aguardando emissão NF
        </p>
      ) : (
        <button className="btn-primary w-full !px-2 !py-1.5 !text-[11px]" onClick={onEmit}>
          Emitir pedido (NF/expedição)
        </button>
      )}
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
// Timeline
// ---------------------------------------------------------------------------

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
    return <p className="mt-1.5 text-xs text-zinc-500">Sem atividades nesta conversa.</p>;
  }
  return (
    <ol className="mt-1.5 space-y-3">
      {events.map((ev, i) => {
        const meta = TIMELINE_TYPE_META[ev.type] ?? { label: ev.type, color: 'bg-zinc-500' };
        const isLast = i === events.length - 1;
        return (
          <li key={ev.id} className="relative flex gap-2.5 pl-4">
            <span className={`absolute left-[3px] top-2.5 w-px bg-night-700/70 ${isLast ? 'h-0' : 'h-full'}`} aria-hidden />
            <span className={`absolute left-0 top-1 h-[7px] w-[7px] rounded-full ring-2 ring-night-900 ${meta.color}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold leading-tight text-zinc-200">{ev.title}</p>
              {ev.detail && <p className="mt-0.5 text-[10px] leading-snug text-zinc-400">{ev.detail}</p>}
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
// NotesPanel
// ---------------------------------------------------------------------------

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
            Nenhuma anotação ainda.
          </p>
        )}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border border-night-700/70 bg-night-800/50 p-2 transition-colors hover:border-night-600">
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
          <button className="btn-primary !px-3 !py-1.5 !text-[11px]" disabled={!draft.trim()} onClick={onSave}>
            Salvar anotação
          </button>
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

