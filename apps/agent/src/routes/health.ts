import type { Metrics } from '../observability/metrics.js';
import type { EvolutionApi } from '../integration/evolution/EvolutionApi.js';
import { PrismaMessageRepository } from '../prisma/MessageRepository.js';
import type { IMessageRepository } from '../prisma/MessageRepository.js';
import type { RedisLike } from '../agent/RedisSessionStore.js';

// ============================================================================
// Telemetria de saude do sistema para o painel CRM (GET /api/system/status).
// Inspirado no running_services_monitor: agrega em um unico JSON o estado do
// processo (uptime/memoria), banco PostgreSQL, Redis e da instancia WhatsApp
// (Evolution API), alem da latencia media das ultimas chamadas de IA.
// ============================================================================

export type ServiceStatus = 'ok' | 'degraded' | 'down';

export interface ServiceHealth {
  status: ServiceStatus;
  message: string;
  detail?: string;
}

export interface SystemStatus {
  overall: ServiceStatus;
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
  /** O proprio agente (a API respondeu) e o estado do roteador de IA. */
  agent: ServiceHealth & { activeProvider: string };
  database: ServiceHealth;
  redis: ServiceHealth;
  evolution: ServiceHealth & { state: string };
  llm: {
    status: ServiceStatus;
    averageResponseMs: number;
    calls: number;
    failovers: number;
    recoveries: number;
  };
}

export interface SystemStatusDeps {
  evolution: EvolutionApi;
  metrics: Metrics;
  repository: IMessageRepository;
  /** Cliente Redis quando habilitado (sessoes/cache); undefined = memoria. */
  redis?: RedisLike & { ping(): Promise<unknown> };
  /** Estado do roteador de IA (provedor ativo e circuito). */
  provider?: { activeProvider: string };
}

export async function collectSystemStatus(deps: SystemStatusDeps): Promise<SystemStatus> {
  const generatedAt = new Date().toISOString();

  const memory = process.memoryUsage();
  const rssMb = bytesToMb(memory.rss);
  const heapUsedMb = bytesToMb(memory.heapUsed);

  // Banco de dados (PostgreSQL via Prisma; memoria no modo demo).
  let database: ServiceHealth;
  try {
    const dbOk = await deps.repository.ping();
    database = dbOk
      ? {
          status: 'ok',
          message: isPrismaRepository(deps.repository)
            ? 'PostgreSQL conectado'
            : 'em memória (sem banco)',
        }
      : { status: 'down', message: 'PostgreSQL indisponível' };
  } catch (err) {
    database = {
      status: 'down',
      message: 'PostgreSQL indisponível',
      detail: (err as Error).message,
    };
  }

  // Redis (sessoes/cache). Nao configurado = design para memoria, nao e falha.
  let redis: ServiceHealth;
  if (!deps.redis) {
    redis = { status: 'ok', message: 'não configurado (sessões em memória)' };
  } else {
    try {
      await deps.redis.ping();
      redis = { status: 'ok', message: 'Redis conectado' };
    } catch (err) {
      redis = {
        status: 'degraded',
        message: 'Redis indisponível',
        detail: (err as Error).message,
      };
    }
  }

  // Evolution API (conexao WhatsApp da instancia).
  const conn = await deps.evolution.getConnectionState();
  const evolution: SystemStatus['evolution'] = {
    state: conn.state,
    ...(conn.connected
      ? { status: 'ok', message: 'WhatsApp conectado' }
      : conn.state === 'connecting'
        ? { status: 'degraded', message: 'WhatsApp conectando...' }
        : { status: 'down', message: 'WhatsApp desconectado', detail: conn.error }),
  };

  // Latencia media das ultimas chamadas de IA (todas as chamadas registradas).
  const llm = aggregateLlm(deps.metrics);

  const critical = [database, evolution].some((s) => s.status === 'down');
  const degraded = [database, evolution, redis, llm].some((s) => s.status !== 'ok');
  const overall: ServiceStatus = critical ? 'down' : degraded ? 'degraded' : 'ok';

  return {
    overall,
    generatedAt,
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      uptimeHuman: formatUptime(process.uptime()),
      node: process.version,
      memoryRssBytes: memory.rss,
      memoryRssMb: rssMb,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      heapUsedMb,
    },
    agent: {
      status: 'ok',
      message: 'Agente respondendo',
      activeProvider: deps.provider?.activeProvider ?? 'unknown',
    },
    database,
    redis,
    evolution,
    llm,
  };
}

function aggregateLlm(metrics: Metrics): SystemStatus['llm'] {
  const snapshot = metrics.snapshot();
  let calls = 0;
  let latencyMs = 0;
  let failovers = 0;
  for (const entry of snapshot.llm) {
    calls += entry.calls;
    latencyMs += entry.latencyMs;
    failovers += entry.failovers;
  }
  const averageResponseMs = calls > 0 ? Math.round(latencyMs / calls) : 0;
  const status: ServiceStatus =
    calls === 0 ? 'ok' : averageResponseMs > 8_000 ? 'degraded' : 'ok';
  return {
    status,
    averageResponseMs,
    calls,
    failovers,
    recoveries: snapshot.recoveries,
  };
}

function isPrismaRepository(repo: IMessageRepository): boolean {
  return repo instanceof PrismaMessageRepository;
}

function bytesToMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
