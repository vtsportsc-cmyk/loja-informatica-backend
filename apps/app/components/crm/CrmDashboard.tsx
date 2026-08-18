// Dashboard Gerencial — visão executiva do CRM (estilo CV CRM / Suri Shop).
'use client';

import { useMemo, useState } from 'react';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUSES, FUNNEL_STATUS_LABELS, FUNNEL_STATUS_COLORS } from '@/lib/funnel';
import type { Agent, Conversation } from '@/lib/crm-types';
import { fmtTime } from '@/lib/crm-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'today' | '7d' | '30d' | 'all';

interface CrmDashboardProps {
  conversations: Conversation[];
  agents: Agent[];
}

// ---------------------------------------------------------------------------
// Funnel stage mapping for the visual chart
// ---------------------------------------------------------------------------

const FUNNEL_CHART_STAGES: Array<{
  status: string;
  label: string;
  color: string;
  barColor: string;
}> = [
  { status: 'NOVO', label: 'Atendimento IA', color: 'text-sky-300', barColor: 'bg-sky-500' },
  { status: 'MONTANDO_PC', label: 'Montando PC', color: 'text-blue-300', barColor: 'bg-blue-500' },
  { status: 'EM_QUALIFICACAO', label: 'Em Qualificação', color: 'text-amber-300', barColor: 'bg-amber-500' },
  { status: 'CARRINHO', label: 'Orçamento Criado', color: 'text-violet-300', barColor: 'bg-violet-500' },
  { status: 'PIX_GERADO', label: 'Aguardando PIX', color: 'text-cyan-300', barColor: 'bg-cyan-500' },
  { status: 'AGUARDANDO_NF', label: 'Aguardando NF', color: 'text-orange-300', barColor: 'bg-orange-500' },
  { status: 'CONCLUIDO', label: 'Concluído', color: 'text-emerald-300', barColor: 'bg-emerald-500' },
  { status: 'CANCELADO', label: 'Cancelado', color: 'text-red-300', barColor: 'bg-red-500' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWithinPeriod(iso: string | null, period: Period): boolean {
  if (!iso || period === 'all') return true;
  const d = new Date(iso);
  const now = Date.now();
  if (period === 'today') {
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }
  const ms = period === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
  return now - d.getTime() < ms;
}

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Tudo' },
];

// ---------------------------------------------------------------------------
// CrmDashboard
// ---------------------------------------------------------------------------

export function CrmDashboard({ conversations, agents }: CrmDashboardProps) {
  const [period, setPeriod] = useState<Period>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('todos');

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      const matchPeriod = isWithinPeriod(c.lastMessageAt, period);
      const matchVendor =
        vendorFilter === 'todos' ||
        (vendorFilter === 'sem-vendedor' && !c.assignedAgentId) ||
        c.assignedAgentId === vendorFilter;
      return matchPeriod && matchVendor;
    });
  }, [conversations, period, vendorFilter]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const active = filtered.filter(
      (c) => c.funnelStatus !== 'CONCLUIDO' && c.funnelStatus !== 'CANCELADO',
    );
    const now24h = Date.now() - 24 * 60 * 60 * 1000;
    const quotes24h = filtered.filter(
      (c) => c.quote && c.lastMessageAt && new Date(c.lastMessageAt).getTime() > now24h,
    );
    const human = filtered.filter((c) => c.humanMode);
    const sold = filtered.filter((c) => c.funnelStatus === 'CONCLUIDO' && c.quote);
    const totalPix = sold.reduce((sum, c) => sum + (c.quote?.pixTotalCents ?? 0), 0);

    return {
      activeCount: active.length,
      quotes24hCount: quotes24h.length,
      humanCount: human.length,
      soldCount: sold.length,
      totalPix,
    };
  }, [filtered]);

  // ── Funnel distribution ──
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of filtered) {
      counts[c.funnelStatus] = (counts[c.funnelStatus] || 0) + 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));
    return FUNNEL_CHART_STAGES.map((stage) => ({
      ...stage,
      count: counts[stage.status] || 0,
      pct: ((counts[stage.status] || 0) / Math.max(1, filtered.length)) * 100,
      barWidth: ((counts[stage.status] || 0) / maxCount) * 100,
    }));
  }, [filtered]);

  // ── Online sellers (agents with active conversations) ──
  const onlineSellers = useMemo(() => {
    const activeAgentIds = new Set(
      filtered
        .filter((c) => c.assignedAgentId && c.funnelStatus !== 'CONCLUIDO' && c.funnelStatus !== 'CANCELADO')
        .map((c) => c.assignedAgentId),
    );
    return agents
      .filter((a) => a.active && activeAgentIds.has(a.id))
      .map((a) => {
        const myConvos = filtered.filter(
          (c) => c.assignedAgentId === a.id && c.funnelStatus !== 'CONCLUIDO' && c.funnelStatus !== 'CANCELADO',
        );
        return { ...a, activeCount: myConvos.length };
      });
  }, [agents, filtered]);

  // ── Alerts ──
  const alerts = useMemo(() => {
    const list: Array<{ type: 'warning' | 'info'; title: string; detail: string }> = [];

    // Low-value quotes about to expire (no activity in 48h)
    const staleQuotes = filtered.filter(
      (c) =>
        c.quote &&
        c.funnelStatus !== 'CONCLUIDO' &&
        c.funnelStatus !== 'CANCELADO' &&
        c.lastMessageAt &&
        Date.now() - new Date(c.lastMessageAt).getTime() > 48 * 60 * 60 * 1000,
    );
    if (staleQuotes.length > 0) {
      list.push({
        type: 'warning',
        title: `${staleQuotes.length} orçamento(s) sem atividade 48h+`,
        detail: staleQuotes
          .slice(0, 3)
          .map((c) => `${c.quote?.code ?? '—'} · ${c.customerName ?? c.whatsappId}`)
          .join('\n'),
      });
    }

    // High-value leads in cart
    const highCart = filtered.filter(
      (c) => c.funnelStatus === 'CARRINHO' && (c.quote?.pixTotalCents ?? 0) > 500000,
    );
    if (highCart.length > 0) {
      list.push({
        type: 'info',
        title: `${highCart.length} lead(s) de alto valor no carrinho`,
        detail: highCart
          .slice(0, 3)
          .map((c) => `${formatBRL(c.quote!.pixTotalCents)} · ${c.customerName ?? c.whatsappId}`)
          .join('\n'),
      });
    }

    // PIX generated but not paid (stale)
    const stalePix = filtered.filter(
      (c) =>
        c.funnelStatus === 'PIX_GERADO' &&
        c.lastMessageAt &&
        Date.now() - new Date(c.lastMessageAt).getTime() > 24 * 60 * 60 * 1000,
    );
    if (stalePix.length > 0) {
      list.push({
        type: 'warning',
        title: `${stalePix.length} PIX(s) aguardando pagamento 24h+`,
        detail: stalePix
          .slice(0, 3)
          .map((c) => `${c.quote?.code ?? '—'} · ${formatBRL(c.quote?.pixTotalCents ?? 0)}`)
          .join('\n'),
      });
    }

    return list;
  }, [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Período</span>
          <div className="flex rounded-lg border border-night-700/70 bg-night-800/40 p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                  period === opt.value
                    ? 'bg-night-700 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Vendedor</span>
          <select
            className="select !w-48 !py-1 !text-[11px]"
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="sem-vendedor">Sem vendedor</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <span className="ml-auto tabular text-[10px] text-zinc-500">
          <span className="font-semibold text-zinc-300">{filtered.length}</span> conversas no período
        </span>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Conversas Ativas"
          value={String(kpis.activeCount)}
          icon={<ChatActiveIcon />}
          color="text-sky-300"
          bg="bg-sky-500/10"
        />
        <KpiCard
          label="Orçamentos (24h)"
          value={String(kpis.quotes24hCount)}
          icon={<QuoteIcon />}
          color="text-violet-300"
          bg="bg-violet-500/10"
        />
        <KpiCard
          label="Transbordos Humanos"
          value={String(kpis.humanCount)}
          icon={<HumanIcon />}
          color="text-brand"
          bg="bg-brand/10"
        />
        <KpiCard
          label="Vendas Concluídas"
          value={String(kpis.soldCount)}
          sub={formatBRL(kpis.totalPix)}
          icon={<SoldIcon />}
          color="text-emerald-300"
          bg="bg-emerald-500/10"
        />
      </div>

      {/* ── Main Content: Funnel Chart + Sidebar ── */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_320px]">

        {/* Funnel Chart */}
        <div className="surface">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Funil de Leads
            </h3>
            <span className="tabular text-[10px] text-zinc-500">
              {filtered.length} total
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {funnelData.map((stage) => (
              <div key={stage.status} className="flex items-center gap-3">
                <span className={`w-36 shrink-0 truncate text-[11px] font-medium ${stage.color}`}>
                  {stage.label}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-night-800/60">
                  <div
                    className={`h-full rounded-md ${stage.barColor} transition-all duration-500`}
                    style={{ width: `${Math.max(stage.barWidth, stage.count > 0 ? 4 : 0)}%` }}
                  />
                </div>
                <span className="tabular w-12 shrink-0 text-right text-[11px] font-semibold text-zinc-300">
                  {stage.count}
                </span>
                <span className="tabular w-12 shrink-0 text-right text-[10px] text-zinc-500">
                  {stage.pct > 0 ? `${stage.pct.toFixed(1)}%` : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* Summary bar */}
          <div className="mt-5 flex items-center gap-1 rounded-lg bg-night-800/30 p-2">
            {funnelData.filter((s) => s.count > 0).map((stage) => {
              const w = filtered.length > 0 ? (stage.count / filtered.length) * 100 : 0;
              return (
                <div
                  key={stage.status}
                  className={`h-2 rounded-sm ${stage.barColor} transition-all duration-500`}
                  style={{ width: `${w}%` }}
                  title={`${stage.label}: ${stage.count}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {funnelData.filter((s) => s.count > 0).map((stage) => (
              <span key={stage.status} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <span className={`h-2 w-2 rounded-sm ${stage.barColor}`} />
                {stage.label} ({stage.count})
              </span>
            ))}
          </div>
        </div>

        {/* ── Right Sidebar: Online Sellers + Alerts ── */}
        <div className="flex flex-col gap-4">

          {/* Online Sellers */}
          <div className="surface">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Vendedores Online
            </h3>
            {onlineSellers.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">Nenhum vendedor com atendimentos ativos.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {onlineSellers.map((seller) => (
                  <div
                    key={seller.id}
                    className="flex items-center gap-2.5 rounded-lg border border-night-700/50 bg-night-800/40 px-3 py-2"
                  >
                    <div className="relative">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                        {seller.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-night-900 bg-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-zinc-100">{seller.name}</p>
                      <p className="text-[10px] text-zinc-500">
                        {seller.role ?? 'Atendente'} · {seller.activeCount} ativo{seller.activeCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Alerts */}
          <div className="surface">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Central de Alertas
            </h3>
            {alerts.length === 0 ? (
              <div className="mt-3 flex flex-col items-center gap-2 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
                  <CheckIcon className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-xs text-zinc-500">Tudo sob controle.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {alerts.map((alert, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border px-3 py-2.5 ${
                      alert.type === 'warning'
                        ? 'border-amber-500/25 bg-amber-500/5'
                        : 'border-sky-500/25 bg-sky-500/5'
                    }`}
                  >
                    <p className={`text-[11px] font-semibold ${alert.type === 'warning' ? 'text-amber-300' : 'text-sky-300'}`}>
                      {alert.title}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-[10px] leading-snug text-zinc-400">
                      {alert.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <div className="surface flex items-start gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg} ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
        <p className={`tabular mt-0.5 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
        {sub && <p className="tabular text-[11px] text-zinc-400">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChatActiveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
      <line x1="10" x2="8" y1="9" y2="9" />
    </svg>
  );
}

function HumanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SoldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3h12l4 6-10 13L2 9z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
