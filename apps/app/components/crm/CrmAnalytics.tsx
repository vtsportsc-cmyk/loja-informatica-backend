// Seção de BI / Métricas (aba "BI" do painel CRM).
'use client';

import { useMemo } from 'react';
import { formatBRL } from '@loja/catalog';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS } from '@/lib/leads';
import type { Conversation } from '@/lib/crm-types';

// ---------------------------------------------------------------------------
// StatCard (reutilizado por CrmKanban/OrdersTable — definido aqui porque
// BiSection é o maior consumidor)
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
// CrmAnalytics
// ---------------------------------------------------------------------------

export function CrmAnalytics({ conversations }: { conversations: Conversation[] }) {
  const bi = useMemo(() => {
    const sources: Array<{ source: string; label: string; count: number }> = [];
    for (const src of LEAD_SOURCES) {
      const count = conversations.filter((c) => c.leadSource === src).length;
      sources.push({ source: src, label: LEAD_SOURCE_LABELS[src], count });
    }
    const nullCount = conversations.filter((c) => !c.leadSource).length;
    sources.push({ source: 'SEM_ORIGEM', label: 'Sem origem', count: nullCount });
    const totalLeads = conversations.length;

    let open = 0;
    let closed = 0;
    let lost = 0;
    let openPix = 0;
    let closedPix = 0;
    let lostPix = 0;
    for (const c of conversations) {
      if (!c.quote) continue;
      const pix = c.quote.pixTotalCents ?? 0;
      if (c.funnelStatus === 'CONCLUIDO') {
        closed += 1;
        closedPix += pix;
      } else if (c.funnelStatus === 'CANCELADO') {
        lost += 1;
        lostPix += pix;
      } else {
        open += 1;
        openPix += pix;
      }
    }

    const conversion = LEAD_SOURCES.map((src) => {
      const group = conversations.filter((c) => c.leadSource === src);
      const converted = group.filter((c) => c.funnelStatus === 'CONCLUIDO' || c.quote).length;
      const total = group.length;
      return { source: src, label: LEAD_SOURCE_LABELS[src], total, converted, rate: total > 0 ? converted / total : 0 };
    }).filter((r) => r.total > 0);

    return { sources, totalLeads, open, closed, lost, openPix, closedPix, lostPix, conversion };
  }, [conversations]);

  const bar = (count: number, total: number) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '0%');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total de leads" value={String(bi.totalLeads)} />
        <StatCard label="Orçamentos abertos" value={String(bi.open)} />
        <StatCard label="Concluídos" value={String(bi.closed)} />
        <StatCard label="Perdidos" value={String(bi.lost)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="surface">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Distribuição de leads por origem</h3>
          <div className="mt-3 space-y-2.5">
            {bi.sources.map((s) => {
              const pct = bi.totalLeads > 0 ? (s.count / bi.totalLeads) * 100 : 0;
              return (
                <div key={s.source} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate text-[11px] text-zinc-300">{s.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-night-700/60">
                    <div
                      className={`h-full rounded-full ${s.source === 'INSTAGRAM' ? 'bg-pink-500' : s.source === 'BUILDER' ? 'bg-brand' : s.source === 'WHATSAPP_DIRECT' ? 'bg-emerald-500' : 'bg-zinc-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="tabular w-16 shrink-0 text-right text-[11px] text-zinc-400">
                    {s.count} <span className="text-zinc-600">({bar(s.count, bi.totalLeads)})</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="surface">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Volume em orçamentos (abertos vs. fechados)</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: 'Abertos', count: bi.open, pix: bi.openPix, cls: 'text-amber-300' },
              { label: 'Concluídos', count: bi.closed, pix: bi.closedPix, cls: 'text-emerald-300' },
              { label: 'Perdidos', count: bi.lost, pix: bi.lostPix, cls: 'text-red-300' },
            ].map((row) => (
              <div key={row.label} className="rounded-lg border border-night-700/60 bg-night-800/40 p-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">{row.label}</p>
                <p className={`tabular mt-0.5 text-lg font-bold ${row.cls}`}>{row.count}</p>
                <p className="tabular text-[10px] text-zinc-400">{formatBRL(row.pix)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="surface">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Taxa de conversão por canal de entrada</h3>
        {bi.conversion.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">Sem leads registrados ainda.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="table-head">Canal</th>
                <th className="table-head text-right">Leads</th>
                <th className="table-head text-right">Convertidos</th>
                <th className="table-head">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {bi.conversion.map((row) => (
                <tr key={row.source} className="border-b border-night-800/70">
                  <td className="px-3 py-2 text-zinc-300">{row.label}</td>
                  <td className="tabular px-3 py-2 text-right text-zinc-400">{row.total}</td>
                  <td className="tabular px-3 py-2 text-right text-zinc-300">{row.converted}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-night-700/60">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(row.rate * 100)}%` }} />
                      </div>
                      <span className="tabular text-[11px] font-semibold text-zinc-300">{Math.round(row.rate * 100)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
