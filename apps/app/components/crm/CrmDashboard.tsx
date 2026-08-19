// Dashboard Gerencial — visão executiva do CRM (estilo Stripe/Linear/Intercom).
'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleCheckBig,
  FileText,
  Info,
  Minus,
  MessageSquare,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { formatBRL } from '@loja/catalog';
import type { Agent, Conversation } from '@/lib/crm-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'today' | '7d' | '30d' | 'all';
type Severity = 'alta' | 'media' | 'info';

interface CrmDashboardProps {
  conversations: Conversation[];
  agents: Agent[];
}

// ---------------------------------------------------------------------------
// Funnel stage mapping for the visual chart (cores estaticas p/ o Tailwind JIT)
// ---------------------------------------------------------------------------

const FUNNEL_CHART_STAGES: Array<{
  status: string;
  label: string;
  textColor: string;
  dot: string;
  gradient: string;
}> = [
  { status: 'NOVO', label: 'Atendimento IA', textColor: 'text-sky-300', dot: 'bg-sky-400', gradient: 'from-sky-500/90 to-sky-400' },
  { status: 'MONTANDO_PC', label: 'Montando PC', textColor: 'text-blue-300', dot: 'bg-blue-400', gradient: 'from-blue-500/90 to-blue-400' },
  { status: 'EM_QUALIFICACAO', label: 'Em Qualificação', textColor: 'text-amber-300', dot: 'bg-amber-400', gradient: 'from-amber-500/90 to-amber-400' },
  { status: 'CARRINHO', label: 'Orçamento Criado', textColor: 'text-violet-300', dot: 'bg-violet-400', gradient: 'from-violet-500/90 to-violet-400' },
  { status: 'PIX_GERADO', label: 'Aguardando PIX', textColor: 'text-cyan-300', dot: 'bg-cyan-400', gradient: 'from-cyan-500/90 to-cyan-400' },
  { status: 'AGUARDANDO_NF', label: 'Aguardando NF', textColor: 'text-orange-300', dot: 'bg-orange-400', gradient: 'from-orange-500/90 to-orange-400' },
  { status: 'CONCLUIDO', label: 'Concluído', textColor: 'text-emerald-300', dot: 'bg-emerald-400', gradient: 'from-emerald-500/90 to-emerald-400' },
  { status: 'CANCELADO', label: 'Cancelado', textColor: 'text-red-300', dot: 'bg-red-400', gradient: 'from-red-500/90 to-red-400' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function isWithinPeriod(iso: string | null, period: Period): boolean {
  if (!iso || period === 'all') return true;
  const d = new Date(iso);
  const now = Date.now();
  if (period === 'today') {
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }
  const ms = period === '7d' ? 7 * DAY_MS : 30 * DAY_MS;
  return now - d.getTime() < ms;
}

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Tudo' },
];

/**
 * Serie diaria (ultimos 7 dias) para a micro-sparkline dos KPIs, derivada do
 * `lastMessageAt` real das conversas — funciona como um "pulso de atividade"
 * e nao um historico contabil exato (nao ha eventos versionados no backend).
 */
function useDailyPulse(base: Conversation[], predicate: (c: Conversation) => boolean) {
  return useMemo(() => {
    const points = new Array(7).fill(0);
    const now = Date.now();
    for (const c of base) {
      if (!c.lastMessageAt || !predicate(c)) continue;
      const diffDays = Math.floor((now - new Date(c.lastMessageAt).getTime()) / DAY_MS);
      const idx = 6 - diffDays;
      if (idx >= 0 && idx < 7) points[idx] += 1;
    }
    const today = points[6];
    const yesterday = points[5];
    let pct: number | null;
    if (yesterday > 0) pct = ((today - yesterday) / yesterday) * 100;
    else if (today > 0) pct = 100;
    else pct = 0;
    return { points, pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, predicate]);
}

// ---------------------------------------------------------------------------
// CrmDashboard
// ---------------------------------------------------------------------------

export function CrmDashboard({ conversations, agents }: CrmDashboardProps) {
  const [period, setPeriod] = useState<Period>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('todos');

  const byVendor = useMemo(() => {
    return conversations.filter((c) => {
      const matchVendor =
        vendorFilter === 'todos' ||
        (vendorFilter === 'sem-vendedor' && !c.assignedAgentId) ||
        c.assignedAgentId === vendorFilter;
      return matchVendor;
    });
  }, [conversations, vendorFilter]);

  const filtered = useMemo(() => {
    return byVendor.filter((c) => isWithinPeriod(c.lastMessageAt, period));
  }, [byVendor, period]);

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

  const activePulse = useDailyPulse(byVendor, (c) => c.funnelStatus !== 'CONCLUIDO' && c.funnelStatus !== 'CANCELADO');
  const quotesPulse = useDailyPulse(byVendor, (c) => Boolean(c.quote));
  const humanPulse = useDailyPulse(byVendor, (c) => c.humanMode);
  const soldPulse = useDailyPulse(byVendor, (c) => c.funnelStatus === 'CONCLUIDO' && Boolean(c.quote));

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

  // ── Alerts (system toast, com severidade) ──
  const alerts = useMemo(() => {
    const list: Array<{ severity: Severity; title: string; detail: string }> = [];

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
        severity: staleQuotes.length >= 3 ? 'alta' : 'media',
        title: `${staleQuotes.length} orçamento(s) sem atividade 48h+`,
        detail: staleQuotes
          .slice(0, 3)
          .map((c) => `${c.quote?.code ?? '—'} · ${c.customerName ?? c.whatsappId}`)
          .join('\n'),
      });
    }

    const stalePix = filtered.filter(
      (c) =>
        c.funnelStatus === 'PIX_GERADO' &&
        c.lastMessageAt &&
        Date.now() - new Date(c.lastMessageAt).getTime() > 24 * 60 * 60 * 1000,
    );
    if (stalePix.length > 0) {
      list.push({
        severity: 'alta',
        title: `${stalePix.length} PIX(s) aguardando pagamento 24h+`,
        detail: stalePix
          .slice(0, 3)
          .map((c) => `${c.quote?.code ?? '—'} · ${formatBRL(c.quote?.pixTotalCents ?? 0)}`)
          .join('\n'),
      });
    }

    const highCart = filtered.filter(
      (c) => c.funnelStatus === 'CARRINHO' && (c.quote?.pixTotalCents ?? 0) > 500000,
    );
    if (highCart.length > 0) {
      list.push({
        severity: 'info',
        title: `${highCart.length} lead(s) de alto valor no carrinho`,
        detail: highCart
          .slice(0, 3)
          .map((c) => `${formatBRL(c.quote!.pixTotalCents)} · ${c.customerName ?? c.whatsappId}`)
          .join('\n'),
      });
    }

    const severityRank: Record<Severity, number> = { alta: 0, media: 1, info: 2 };
    return list.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-0.5">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Período</span>
          <SegmentedControl
            value={period}
            onChange={setPeriod}
            options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
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
          icon={<MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} />}
          accent="sky"
          pulse={activePulse}
        />
        <KpiCard
          label="Orçamentos (24h)"
          value={String(kpis.quotes24hCount)}
          icon={<FileText className="h-[18px] w-[18px]" strokeWidth={2} />}
          accent="violet"
          pulse={quotesPulse}
        />
        <KpiCard
          label="Transbordos Humanos"
          value={String(kpis.humanCount)}
          icon={<UserCog className="h-[18px] w-[18px]" strokeWidth={2} />}
          accent="emerald"
          pulse={humanPulse}
        />
        <KpiCard
          label="Vendas Concluídas"
          value={String(kpis.soldCount)}
          sub={formatBRL(kpis.totalPix)}
          icon={<Wallet className="h-[18px] w-[18px]" strokeWidth={2} />}
          accent="cyan"
          pulse={soldPulse}
        />
      </div>

      {/* ── Main Content: Funnel Chart + Sidebar ── */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_320px]">

        {/* Funnel Chart */}
        <div className="glass-panel">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Funil de Leads
            </h3>
            <span className="tabular text-[10px] text-zinc-500">
              {filtered.length} total
            </span>
          </div>
          <div className="mt-5 space-y-3.5">
            {funnelData.map((stage) => (
              <div key={stage.status} className="group flex items-center gap-3">
                <span className={`w-36 shrink-0 truncate text-[11px] font-medium ${stage.textColor}`}>
                  {stage.label}
                </span>
                <div className="relative h-6 flex-1">
                  <div className="h-full overflow-hidden rounded-md bg-night-800/60 ring-1 ring-inset ring-white/[0.03]">
                    <div
                      className={`h-full rounded-md bg-gradient-to-r ${stage.gradient} shadow-[0_0_10px_-2px_rgba(0,0,0,0.5)] transition-all duration-700 ease-out`}
                      style={{ width: `${Math.max(stage.barWidth, stage.count > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  {/* Tooltip flutuante */}
                  {stage.count > 0 && (
                    <div
                      className="pointer-events-none absolute -top-9 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-700/60 bg-night-900/95 px-2.5 py-1.5 text-[10px] font-medium text-zinc-100 opacity-0 shadow-xl shadow-black/40 backdrop-blur-md transition-all duration-200 group-hover:opacity-100"
                      style={{ left: `${Math.min(Math.max(stage.barWidth, 4), 96)}%` }}
                    >
                      <span className={stage.textColor}>{stage.label}</span>{' '}
                      <span className="text-zinc-400">· {stage.count} ({stage.pct.toFixed(1)}%)</span>
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-700/60" />
                    </div>
                  )}
                </div>
                <span className="tabular w-8 shrink-0 text-right text-[11px] font-semibold text-zinc-300">
                  {stage.count}
                </span>
                <span className="tabular w-12 shrink-0 text-right text-[10px] text-zinc-500">
                  {stage.pct > 0 ? `${stage.pct.toFixed(1)}%` : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* Summary bar */}
          <div className="mt-5 flex items-center gap-1 rounded-lg bg-night-800/30 p-2 ring-1 ring-inset ring-white/[0.03]">
            {funnelData.filter((s) => s.count > 0).map((stage) => {
              const w = filtered.length > 0 ? (stage.count / filtered.length) * 100 : 0;
              return (
                <div
                  key={stage.status}
                  className={`h-2 rounded-sm bg-gradient-to-r ${stage.gradient} transition-all duration-700`}
                  style={{ width: `${w}%` }}
                  title={`${stage.label}: ${stage.count}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {funnelData.filter((s) => s.count > 0).map((stage) => (
              <span key={stage.status} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <span className={`h-2 w-2 rounded-sm ${stage.dot}`} />
                {stage.label} ({stage.count})
              </span>
            ))}
          </div>
        </div>

        {/* ── Right Sidebar: Online Sellers + Alerts ── */}
        <div className="flex flex-col gap-4">

          {/* Online Sellers */}
          <div className="glass-panel">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Vendedores Online
              </h3>
              <Users className="h-3.5 w-3.5 text-zinc-600" strokeWidth={2} />
            </div>
            {onlineSellers.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">Nenhum vendedor com atendimentos ativos.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {onlineSellers.map((seller) => (
                  <div
                    key={seller.id}
                    className="flex items-center gap-2.5 rounded-lg border border-zinc-800/50 bg-night-800/40 px-3 py-2 transition-colors hover:border-zinc-700/60"
                  >
                    <div className="relative shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-[10px] font-bold text-white">
                        {seller.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="status-ring-online absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-night-900 bg-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-zinc-100">{seller.name}</p>
                      <p className="text-[10px] text-zinc-500">
                        {seller.role ?? 'Atendente'} · {seller.activeCount} ativo{seller.activeCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="tabular shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
                      {seller.activeCount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Alerts */}
          <div className="glass-panel min-h-0 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Central de Alertas
              </h3>
              {alerts.length > 0 && (
                <span className="tabular rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-300 ring-1 ring-inset ring-rose-500/25">
                  {alerts.length}
                </span>
              )}
            </div>
            {alerts.length === 0 ? (
              <div className="mt-3 flex flex-col items-center gap-2 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20">
                  <CircleCheckBig className="h-4 w-4 text-emerald-400" strokeWidth={2} />
                </div>
                <p className="text-xs text-zinc-500">Tudo sob controle.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {alerts.map((alert, i) => (
                  <AlertToast key={i} severity={alert.severity} title={alert.title} detail={alert.detail} />
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
// SegmentedControl — pill animado reutilizavel (period, module toggles, etc.)
// ---------------------------------------------------------------------------

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const count = options.length;
  return (
    <div className="segmented" role="tablist">
      <span
        className="segmented-thumb"
        style={{
          width: `calc(${100 / count}% - 4px)`,
          transform: `translateX(calc(${index * 100}% + ${index * 4}px))`,
        }}
        aria-hidden
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`segmented-btn ${value === opt.value ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Card — numero + badge de tendencia + micro-sparkline
// ---------------------------------------------------------------------------

const ACCENT_STYLES: Record<string, { bg: string; text: string; ring: string; line: string; fill: string }> = {
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-300', ring: 'ring-sky-500/20', line: '#38bdf8', fill: 'rgba(56,189,248,0.16)' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-300', ring: 'ring-violet-500/20', line: '#a78bfa', fill: 'rgba(167,139,250,0.16)' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', ring: 'ring-emerald-500/20', line: '#34d399', fill: 'rgba(52,211,153,0.16)' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-300', ring: 'ring-cyan-500/20', line: '#22d3ee', fill: 'rgba(34,211,238,0.16)' },
};

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
  pulse,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: keyof typeof ACCENT_STYLES;
  pulse: { points: number[]; pct: number | null };
}) {
  const style = ACCENT_STYLES[accent];
  const trendUp = (pulse.pct ?? 0) > 0;
  const trendFlat = (pulse.pct ?? 0) === 0;

  return (
    <div className="glass-panel group relative overflow-hidden !p-3.5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.bg} ${style.text} ring-1 ring-inset ${style.ring}`}>
          {icon}
        </div>
        <TrendBadge pct={pulse.pct} />
      </div>
      <div className="mt-3 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
        <div className="mt-0.5 flex items-end justify-between gap-2">
          <p className={`tabular text-2xl font-bold tracking-tight ${style.text}`}>{value}</p>
          <Sparkline points={pulse.points} stroke={style.line} fill={style.fill} />
        </div>
        {sub && <p className="tabular mt-0.5 text-[11px] text-zinc-400">{sub}</p>}
        {!trendFlat && (
          <p className="mt-1 text-[9px] text-zinc-600">{trendUp ? 'alta' : 'queda'} vs. ontem</p>
        )}
      </div>
    </div>
  );
}

function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500 ring-1 ring-inset ring-zinc-500/20">
        <Minus className="h-2.5 w-2.5" strokeWidth={3} />
        0%
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${
        up
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'
          : 'bg-rose-500/10 text-rose-300 ring-rose-500/25'
      }`}
    >
      {up ? <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={3} /> : <ArrowDownRight className="h-2.5 w-2.5" strokeWidth={3} />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — micro grafico de tendencia em SVG (sem dependencias externas)
// ---------------------------------------------------------------------------

function Sparkline({ points, stroke, fill }: { points: number[]; stroke: string; fill: string }) {
  const w = 64;
  const h = 24;
  const max = Math.max(1, ...points);
  const step = w / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => [i * step, h - (p / max) * (h - 4) - 2]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <path d={area} fill={fill} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={2} fill={stroke} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// AlertToast — card de alerta com severidade (Alta/Media/Info)
// ---------------------------------------------------------------------------

const SEVERITY_META: Record<Severity, { label: string; cls: string; iconCls: string; icon: React.ReactNode }> = {
  alta: {
    label: 'Alta',
    cls: 'border-rose-500/25 bg-rose-500/5',
    iconCls: 'bg-rose-500/15 text-rose-300 ring-rose-500/25',
    icon: <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />,
  },
  media: {
    label: 'Média',
    cls: 'border-amber-500/25 bg-amber-500/5',
    iconCls: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
    icon: <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />,
  },
  info: {
    label: 'Info',
    cls: 'border-sky-500/25 bg-sky-500/5',
    iconCls: 'bg-sky-500/15 text-sky-300 ring-sky-500/25',
    icon: <Info className="h-3.5 w-3.5" strokeWidth={2} />,
  },
};

function AlertToast({ severity, title, detail }: { severity: Severity; title: string; detail: string }) {
  const meta = SEVERITY_META[severity];
  return (
    <div className={`toast-alert animate-fade-in-up ${meta.cls}`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${meta.iconCls}`}>
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider ${meta.iconCls}`}>
            {meta.label}
          </span>
          <p className="truncate text-[11px] font-semibold text-zinc-100">{title}</p>
        </div>
        <p className="mt-1 whitespace-pre-line text-[10px] leading-snug text-zinc-400">{detail}</p>
      </div>
    </div>
  );
}
