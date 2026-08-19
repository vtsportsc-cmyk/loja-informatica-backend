// Workstation de atendimento (3 colunas): conversas, chat e contexto do lead/PC montado.
'use client';

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
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LOST_REASON_LABELS, type LostReason } from '@/lib/leads';
import { formatPhoneBR } from '@/lib/phone';
import type { Agent, Conversation, QuoteItem, QuoteSummary, TimelineEvent, Note } from '@/lib/crm-types';
import { fmtTime, fmtDate } from '@/lib/crm-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string | null;
  agentId: string | null;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ChatMessage[];
  timeline: TimelineEvent[];
  notes: Note[];
}

export const QUICK_REPLIES = [
  { label: 'Olá! Como posso ajudar?', text: 'Olá! 👋 Como posso ajudar você hoje?' },
  { label: 'Aguardando confirmação', text: 'Estou aguardando sua confirmação. Qualquer dúvida, estou à disposição!' },
  { label: 'Orçamento disponível', text: 'Seu orçamento está pronto! Confira os detalhes e me avise se deseja prosseguir.' },
  { label: 'PIX gerado', text: 'O PIX foi gerado! Verifique os dados de pagamento no link do orçamento.' },
  {
    label: 'Formas de pagamento',
    text: 'Aceitamos PIX (com desconto e confirmação na hora) para compras online. Cartão de crédito é aceito EXCLUSIVAMENTE em compras presenciais em nossa loja física.',
  },
  { label: 'Agradecimento', text: 'Obrigado pela preferência! Se precisar de algo mais, é só chamar. 🙌' },
];

export interface CrmWorkstationProps {
  conversations: Conversation[];
  filtered: Conversation[];
  agents: Agent[];
  selectedId: string | null;
  detail: ConversationDetail | null;
  operatorName: string;

  search: string;
  onSearchChange: (v: string) => void;
  departmentFilter: string;
  onDepartmentFilterChange: (v: string) => void;
  onOpenConversation: (id: string) => void;

  draft: string;
  onDraftChange: (v: string) => void;
  sending: boolean;
  typing: boolean;
  onSendMessage: () => void;
  showQuickReplies: boolean;
  onToggleQuickReplies: () => void;
  onSelectQuickReply: (text: string) => void;
  onHandoff: (action: 'assume' | 'release') => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;

  sidebarTab: 'resumo' | 'anotacoes';
  onSidebarTabChange: (tab: 'resumo' | 'anotacoes') => void;
  statusDraft: string;
  onStatusDraftChange: (v: string) => void;
  onChangeStatus: () => void;
  departmentDraft: string;
  onDepartmentDraftChange: (v: string) => void;
  agentDraft: string;
  onAgentDraftChange: (v: string) => void;
  onSaveDepartment: () => void;
  leadSourceDraft: string;
  onLeadSourceDraftChange: (v: string) => void;
  onSaveLeadSource: () => void;
  noteDraft: string;
  onNoteDraftChange: (v: string) => void;
  onSaveNote: () => void;
  onEmitOrder: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers de apresentacao
// ---------------------------------------------------------------------------

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

/** Deriva a plataforma (AMD/Intel) do setup a partir dos nomes dos itens — mesmo catalogo do /builder. */
function inferPlatform(items: QuoteItem[]): 'AMD' | 'Intel' | null {
  const text = items.map((i) => i.name.toLowerCase()).join(' ');
  if (/\bryzen\b|\bamd\b/.test(text)) return 'AMD';
  if (/\bintel\b|\bcore i[3579]\b/.test(text)) return 'Intel';
  return null;
}

// ---------------------------------------------------------------------------
// CrmWorkstation
// ---------------------------------------------------------------------------

export function CrmWorkstation(props: CrmWorkstationProps) {
  const {
    filtered,
    conversations,
    agents,
    selectedId,
    detail,
    operatorName,
    search,
    onSearchChange,
    departmentFilter,
    onDepartmentFilterChange,
    onOpenConversation,
    draft,
    onDraftChange,
    sending,
    typing,
    onSendMessage,
    showQuickReplies,
    onToggleQuickReplies,
    onSelectQuickReply,
    onHandoff,
    chatEndRef,
    sidebarTab,
    onSidebarTabChange,
    statusDraft,
    onStatusDraftChange,
    onChangeStatus,
    departmentDraft,
    onDepartmentDraftChange,
    agentDraft,
    onAgentDraftChange,
    onSaveDepartment,
    leadSourceDraft,
    onLeadSourceDraftChange,
    onSaveLeadSource,
    noteDraft,
    onNoteDraftChange,
    onSaveNote,
    onEmitOrder,
  } = props;

  const selected = detail?.conversation ?? null;

  return (
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
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded border border-night-600 bg-night-800/80 px-1 font-mono text-[9px] text-zinc-500">
              <Command className="h-2.5 w-2.5" strokeWidth={2.5} />K
            </kbd>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <select
              className="select !border-zinc-800/60 !py-1 !text-[11px]"
              value={departmentFilter}
              onChange={(e) => onDepartmentFilterChange(e.target.value)}
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
                onClick={() => onOpenConversation(c.id)}
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
                    onClick={() => onHandoff('release')}
                    title="Liberar para a IA"
                  >
                    <Bot className="h-3 w-3" strokeWidth={2} /> Liberar p/ IA
                  </button>
                ) : (
                  <button
                    className="btn-primary !px-2.5 !py-1 !text-[11px]"
                    onClick={() => onHandoff('assume')}
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
            <div className="border-t border-zinc-800/50 bg-night-900/60 px-4 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
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
                  onClick={() => onHandoff(selected.humanMode ? 'release' : 'assume')}
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
                  onClick={onToggleQuickReplies}
                >
                  <Tag className="h-3 w-3" strokeWidth={2} /> Templates
                </button>
                {/* Botao em destaque: Gerar Cobranca PIX (requisito UX) */}
                <button
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 px-3 py-1.5 text-[10px] font-bold text-night-950 shadow-md shadow-emerald-500/20 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  title="Gerar cobrança PIX para este cliente"
                  onClick={() => {
                    if (selected.quote) {
                      toast.info('Cobrança PIX', {
                        description: `PIX de ${formatBRL(selected.quote.pixTotalCents)} — código: ${selected.quote.code}`,
                      });
                    } else {
                      toast.info('Conversa sem orçamento vinculado', { description: 'Vincule um orçamento para gerar a cobrança PIX.' });
                    }
                  }}
                >
                  <QrCode className="h-3.5 w-3.5" strokeWidth={2.25} /> Gerar Cobrança PIX
                </button>
              </div>
              {showQuickReplies && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {QUICK_REPLIES.map((qr, i) => (
                    <button
                      key={i}
                      className="rounded-md border border-night-600 bg-night-800/60 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:border-night-500 hover:bg-night-800 hover:text-white"
                      onClick={() => onSelectQuickReply(qr.text)}
                    >
                      {qr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-zinc-800/50 bg-night-900/80 p-3 backdrop-blur">
              <div className="flex gap-2">
                <input
                  className="input !border-zinc-800/60 !py-1.5 !text-xs"
                  placeholder="Digite sua mensagem..."
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !sending) onSendMessage();
                  }}
                  disabled={sending}
                />
                <button
                  className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs"
                  disabled={!draft.trim() || sending}
                  onClick={onSendMessage}
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
                onClick={() => onSidebarTabChange('resumo')}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all ${
                  sidebarTab === 'resumo' ? 'bg-night-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                Ficha
              </button>
              <button
                onClick={() => onSidebarTabChange('anotacoes')}
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
                      onChange={(e) => onStatusDraftChange(e.target.value)}
                    >
                      {FUNNEL_STATUSES.map((s) => (
                        <option key={s} value={s}>{FUNNEL_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    <button className="btn-ghost shrink-0 !px-2 !py-1 !text-[11px]" onClick={onChangeStatus}>Salvar</button>
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
                      <select className="select !py-1.5 !text-xs" value={departmentDraft} onChange={(e) => onDepartmentDraftChange(e.target.value)}>
                        <option value="none">Sem departamento</option>
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                        ))}
                      </select>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${departmentDraft !== 'none' && isDepartment(departmentDraft) ? DEPARTMENT_COLORS[departmentDraft as Department] : 'bg-zinc-500'}`} />
                    </div>
                    <div className="flex items-center gap-2">
                      <select className="select !py-1.5 !text-xs" value={agentDraft} onChange={(e) => onAgentDraftChange(e.target.value)}>
                        <option value="none">Nenhum atendente</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${a.role}` : ''}</option>
                        ))}
                      </select>
                      <button className="btn-ghost shrink-0 !px-2 !py-1 !text-[11px]" onClick={onSaveDepartment}>Salvar</button>
                    </div>
                  </div>
                </Section>

                {/* Origem do Lead */}
                <Section title="Origem do Lead">
                  <div className="mt-1.5 flex items-center gap-2">
                    <select className="select !py-1.5 !text-xs" value={leadSourceDraft} onChange={(e) => onLeadSourceDraftChange(e.target.value)}>
                      <option value="none">Sem origem</option>
                      {LEAD_SOURCES.map((s) => (
                        <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
                      ))}
                    </select>
                    <button className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={onSaveLeadSource}>Salvar</button>
                  </div>
                </Section>

                {/* Setup montado (Monte seu PC) / Orçamento */}
                <Section title="Setup Montado · PC Gamer">
                  {selected.quote ? (
                    <WorkstationOrderSummary
                      quote={selected.quote}
                      status={selected.funnelStatus}
                      onEmit={() => onEmitOrder(selected.id)}
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
                  agentName={operatorName}
                  draft={noteDraft}
                  onDraftChange={onNoteDraftChange}
                  onSave={onSaveNote}
                />
              </div>
            )}
          </>
        )}
      </div>
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
  const platform = inferPlatform(quote.items);
  return (
    <div className="mt-1.5 space-y-3 overflow-hidden rounded-xl border border-zinc-800/60 bg-gradient-to-b from-night-800/60 to-night-800/30 p-3 shadow-sm shadow-black/10">
      {/* Header: codigo + plataforma + badge de compatibilidade */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-mono text-xs font-bold text-brand">{quote.code}</span>
        <div className="flex items-center gap-1.5">
          {platform && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset ${
                platform === 'AMD'
                  ? 'bg-red-500/10 text-red-300 ring-red-500/25'
                  : 'bg-blue-500/10 text-blue-300 ring-blue-500/25'
              }`}
            >
              {platform === 'AMD' ? '🔴' : '🔵'} {platform}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
            <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
            Compatível
          </span>
        </div>
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
          <dt>ou {quote.installments}x de (ref.)</dt>
          <dd className="tabular">{formatBRL(quote.monthlyValueCents)}</dd>
        </div>
      </dl>

      {/* Cobrança PIX — proeminente (unico metodo de pagamento online) */}
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
      <p className="text-center text-[9px] text-zinc-600">
        Pagamento online exclusivo via PIX · cartão apenas na loja física
      </p>

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
