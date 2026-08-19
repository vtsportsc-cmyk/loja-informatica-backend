'use client';

import { useCallback, useEffect, useState } from 'react';

// ============================================================================
// Widget "Saúde do Sistema" do painel CRM.
// Badge discreto na barra superior com o status geral (verde/âmbar/vermelho);
// ao clicar, abre um drawer com os cartões: Agente IA, Servidor VPS, Banco de
// Dados e Conexão WhatsApp. Dados vêm de GET /api/system/status (apps/agent).
// ============================================================================

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface SystemHealth {
  overall: HealthStatus;
  generatedAt: string;
  process: {
    uptimeSeconds: number;
    uptimeHuman: string;
    node: string;
    memoryRssBytes: number;
    memoryRssMb: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    heapUsedMb: number;
  };
  agent: { status: HealthStatus; message: string; activeProvider: string };
  database: { status: HealthStatus; message: string; detail?: string };
  redis: { status: HealthStatus; message: string; detail?: string };
  evolution: { status: HealthStatus; message: string; state: string; detail?: string };
  llm: {
    status: HealthStatus;
    averageResponseMs: number;
    calls: number;
    failovers: number;
    recoveries: number;
  };
}

const POLL_MS = 60_000;
const DRAWER_POLL_MS = 30_000;

function dotFor(level: HealthStatus): string {
  switch (level) {
    case 'ok':
      return 'bg-emerald-400';
    case 'degraded':
      return 'bg-amber-400';
    default:
      return 'bg-red-400';
  }
}

function fmtMs(ms: number): string {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function SystemHealthBadge() {
  const [status, setStatus] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/system/status', { cache: 'no-store' });
      const body = (await res.json()) as { ok?: boolean; status?: SystemHealth };
      if (res.ok && body.status) {
        setStatus(body.status);
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError('Agente indisponível');
        setStatus(null);
      }
    } catch {
      setError('Falha ao consultar o sistema');
      setStatus(null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Poll em background para manter o dot atualizado mesmo com o drawer fechado.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Drawer aberto: atualiza na hora e re-consulta a cada 30s.
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = setInterval(() => void refresh(), DRAWER_POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  const level: HealthStatus = !status ? 'down' : status.overall;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost !px-2.5 !py-1.5 !text-xs"
        title="Saúde do Sistema"
        aria-label="Saúde do Sistema"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotFor(level)}`} aria-hidden />
        <span>Saúde</span>
      </button>

      {open && (
        <SystemHealthDrawer
          status={status}
          error={error}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          onRefresh={() => void refresh()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SystemHealthDrawer({
  status,
  error,
  refreshing,
  lastUpdated,
  onRefresh,
  onClose,
}: {
  status: SystemHealth | null;
  error: string | null;
  refreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-night-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative z-10 flex h-dvh w-full max-w-sm flex-col border-l border-night-700/70 bg-night-900 shadow-pop">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-night-700/70 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-50">Saúde do Sistema</h2>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              {lastUpdated
                ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR')}`
                : 'Consultando...'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="btn-ghost !px-2 !py-1 !text-[10px]"
              onClick={onRefresh}
              disabled={refreshing}
              title="Atualizar agora"
            >
              {refreshing ? '…' : 'Atualizar'}
            </button>
            <button
              className="btn-ghost !px-2 !py-1 !text-[10px]"
              onClick={onClose}
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {error && !status && (
            <p className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {status && (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-night-700/70 bg-night-800/60 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Status geral
                </span>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                  <span className={`h-1.5 w-1.5 rounded-full ${dotFor(status.overall)}`} />
                  {overallLabel(status.overall)}
                </span>
              </div>

              <StatusCard
                title="Agente IA"
                health={status.agent}
                sub={`Provedor ${status.agent.activeProvider} · latência média ${fmtMs(status.llm.averageResponseMs)} · ${status.llm.calls} chamadas`}
              />
              <StatusCard
                title="Servidor VPS"
                health={{ status: 'ok', message: 'Processo ativo' }}
                sub={`Uptime ${status.process.uptimeHuman} · RAM heap ${status.process.heapUsedMb} MB / RSS ${status.process.memoryRssMb} MB`}
              />
              <StatusCard title="Banco de Dados" health={status.database} sub={status.database.detail} />
              <StatusCard
                title="Conexão WhatsApp"
                health={status.evolution}
                sub={status.evolution.state !== 'unknown' ? `Estado: ${status.evolution.state}` : status.evolution.detail}
              />
              <StatusCard
                title="Redis"
                health={status.redis}
                sub={status.redis.detail}
              />
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-night-700/70 px-4 py-2 text-[10px] text-zinc-500">
          {status
            ? `Node ${status.process.node} · up ${status.process.uptimeHuman}`
            : 'Sem dados de telemetria'}
        </footer>
      </aside>
    </div>
  );
}

function StatusCard({
  title,
  health,
  sub,
}: {
  title: string;
  health: { status: HealthStatus; message: string };
  sub?: string;
}) {
  return (
    <div className="surface !p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{title}</p>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotFor(health.status)}`} aria-hidden />
      </div>
      <p className="mt-1 text-xs font-medium text-zinc-100">{health.message}</p>
      {sub && <p className="tabular mt-0.5 text-[10px] leading-snug text-zinc-500">{sub}</p>}
    </div>
  );
}

function overallLabel(level: HealthStatus): string {
  switch (level) {
    case 'ok':
      return 'Operacional';
    case 'degraded':
      return 'Atenção';
    default:
      return 'Fora do ar';
  }
}
