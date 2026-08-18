// Kanban do funil de vendas + tabela densa ( aba "Funil de Vendas").
'use client';

import { useMemo, useState } from 'react';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUSES, FUNNEL_STATUS_LABELS } from '@/lib/funnel';
import { DEPARTMENT_LABELS, type Department } from '@/lib/departments';
import { LEAD_SOURCE_LABELS, type LeadSource } from '@/lib/leads';
import type { Agent, Conversation } from '@/lib/crm-types';
import { fmtTime, statusDot, statusPill } from '@/lib/crm-types';

// ---------------------------------------------------------------------------
// Icons (mantidos aqui porque so o Kanban os usa)
// ---------------------------------------------------------------------------

function SparkIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
    </svg>
  );
}

function ArrowUpRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Kanban board
// ---------------------------------------------------------------------------

function Kanban({
  conversations,
  onOpen,
}: {
  conversations: Conversation[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="scroll-slim flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
      {FUNNEL_STATUSES.map((status) => {
        const cards = conversations.filter((c) => c.funnelStatus === status);
        const totalValue = cards.reduce((sum, c) => sum + (c.quote?.pixTotalCents ?? 0), 0);
        return (
          <div key={status} className="surface flex min-w-[252px] max-w-[260px] flex-col !p-0">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-night-700/70 bg-night-900/95 px-3 py-2 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${statusDot(status)}`} />
                <span className="text-xs font-semibold text-zinc-200">{FUNNEL_STATUS_LABELS[status]}</span>
              </div>
              <span className="tabular rounded-md bg-night-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">{cards.length}</span>
            </div>
            {totalValue > 0 && (
              <div className="border-b border-night-700/60 px-3 py-1.5">
                <p className="tabular text-[10px] text-zinc-500">{formatBRL(totalValue)} <span className="text-zinc-600">PIX</span></p>
              </div>
            )}
            <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {cards.length === 0 && <p className="px-2 py-6 text-center text-[10px] text-zinc-600">vazio</p>}
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  className={`group w-full rounded-lg border bg-night-800/60 p-2 text-left transition-all hover:-translate-y-px hover:border-night-500 hover:bg-night-800 hover:shadow-card ${c.funnelStatus === 'ALTA_VALOR' ? 'border-rose-500/25 hover:border-rose-500/50' : 'border-night-700/70'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-zinc-100">{c.customerName || c.whatsappId}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="tabular text-[10px] text-zinc-500">{fmtTime(c.lastMessageAt)}</span>
                      <ArrowUpRightIcon className="text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </div>
                  {c.funnelStatus === 'ALTA_VALOR' && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-inset ring-rose-500/30 shadow-glow">
                        <SparkIcon /> Alto valor
                      </span>
                      {c.quote && <span className="tabular text-[10px] font-semibold text-rose-200">{formatBRL(c.quote.pixTotalCents)}</span>}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
                    {c.quote && c.funnelStatus !== 'ALTA_VALOR' && (
                      <>
                        <span className="chip font-mono !text-brand">{c.quote.code}</span>
                        <span className="tabular font-semibold text-brand">{formatBRL(c.quote.pixTotalCents)}</span>
                      </>
                    )}
                    {c.department && <span className="chip text-zinc-500">{DEPARTMENT_LABELS[c.department as Department] ?? c.department}</span>}
                    {c.leadSource && (
                      <span className={`chip ${c.leadSource === 'INSTAGRAM' ? 'bg-pink-500/10 text-pink-300 ring-pink-500/25' : c.leadSource === 'BUILDER' ? 'bg-brand/10 text-brand ring-brand/25' : 'text-zinc-400'}`}>
                        {LEAD_SOURCE_LABELS[c.leadSource as LeadSource] ?? c.leadSource}
                      </span>
                    )}
                    {c.unreadCount > 0 && <span className="tabular rounded-full bg-red-500 px-1.5 py-px font-bold text-white">{c.unreadCount}</span>}
                    <span className={`ml-auto inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset ${c.humanMode ? 'bg-brand/10 text-brand ring-brand/25' : 'bg-sky-500/10 text-sky-300 ring-sky-500/25'}`}>
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

// ---------------------------------------------------------------------------
// Dense table
// ---------------------------------------------------------------------------

function DenseTable({
  conversations,
  agents,
  onOpen,
}: {
  conversations: Conversation[];
  agents: Agent[];
  onOpen: (id: string) => void;
}) {
  const rows = [...conversations].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  const agentLabel = (id: string | null): string => {
    if (!id) return '—';
    return agents.find((a) => a.id === id)?.name ?? id;
  };

  return (
    <div className="surface min-h-0 flex-1 overflow-auto !p-0">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="table-head">Cliente</th>
            <th className="table-head">Telefone</th>
            <th className="table-head">Peças Principais</th>
            <th className="table-head">Valor PIX/Parcelado</th>
            <th className="table-head">Status</th>
            <th className="table-head">Atendente Responsável</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-10 text-center text-zinc-500">Nenhuma conversa encontrada.</td></tr>
          )}
          {rows.map((c) => {
            const items = c.quote?.items ?? [];
            const parts = items.slice(0, 2).map((i) => `${i.quantity}x ${i.name}`).join(' · ');
            return (
              <tr key={c.id} onClick={() => onOpen(c.id)} className="group cursor-pointer border-b border-night-800/70 transition-colors hover:bg-night-800/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(c.funnelStatus)}`} />
                    <span className="font-medium text-zinc-100">{c.customerName || c.whatsappId}</span>
                    {c.quote && <span className="font-mono text-[10px] text-brand">{c.quote.code}</span>}
                    {c.funnelStatus === 'ALTA_VALOR' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 text-[8px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-inset ring-rose-500/30">
                        <SparkIcon /> alto valor
                      </span>
                    )}
                  </div>
                </td>
                <td className="tabular px-3 py-2 text-zinc-400">{c.whatsappId}</td>
                <td className="max-w-[260px] truncate px-3 py-2 text-zinc-300">
                  {items.length === 0 ? <span className="text-zinc-600">—</span> : <>{parts}{items.length > 2 && <span className="text-zinc-500"> +{items.length - 2} itens</span>}</>}
                </td>
                <td className="tabular px-3 py-2">
                  {c.quote ? (
                    <><span className="font-semibold text-brand">{formatBRL(c.quote.pixTotalCents)}</span><span className="ml-1 text-[10px] text-zinc-400">ou {c.quote.installments}x {formatBRL(c.quote.monthlyValueCents)}</span></>
                  ) : <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusPill(c.funnelStatus)}`}>
                    {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                  </span>
                </td>
                <td className="tabular px-3 py-2 text-zinc-400">{agentLabel(c.assignedAgentId)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmKanbanView — view exportada: toggle + kanban/tabela
// ---------------------------------------------------------------------------

export function CrmKanbanView({
  conversations,
  agents,
  viewMode,
  onViewModeChange,
  onOpen,
}: {
  conversations: Conversation[];
  agents: Agent[];
  viewMode: 'kanban' | 'table';
  onViewModeChange: (mode: 'kanban' | 'table') => void;
  onOpen: (id: string) => void;
}) {
  const [agentFilter, setAgentFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      const matchesAgent =
        agentFilter === 'todos' ||
        (agentFilter === 'sem-atendente' && !c.assignedAgentId) ||
        c.assignedAgentId === agentFilter;
      const matchesStatus =
        statusFilter === 'todos' || c.funnelStatus === statusFilter;
      return matchesAgent && matchesStatus;
    });
  }, [conversations, agentFilter, statusFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-night-700/70 bg-night-800/40 p-0.5">
            <button
              onClick={() => onViewModeChange('kanban')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${viewMode === 'kanban' ? 'bg-night-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              Kanban
            </button>
            <button
              onClick={() => onViewModeChange('table')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${viewMode === 'table' ? 'bg-night-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              Tabela
            </button>
          </div>
          <select
            className="select !py-1 !text-[11px]"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="todos">Todos agentes</option>
            <option value="sem-atendente">Sem atendente</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select
            className="select !py-1 !text-[11px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="todos">Todos status</option>
            {FUNNEL_STATUSES.map((s) => (
              <option key={s} value={s}>{FUNNEL_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <span className="tabular text-[10px] text-zinc-500">
          <span className="font-semibold text-zinc-300">{filtered.length}</span>
          {filtered.length !== conversations.length && (
            <span className="text-zinc-600">/{conversations.length}</span>
          )}{' '}
          conversas
        </span>
      </div>
      {viewMode === 'kanban' ? (
        <Kanban conversations={filtered} onOpen={onOpen} />
      ) : (
        <DenseTable conversations={filtered} agents={agents} onOpen={onOpen} />
      )}
    </div>
  );
}
