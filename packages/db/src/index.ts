import { PrismaClient } from '@prisma/client';

export { PrismaClient } from '@prisma/client';
export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __lojaPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__lojaPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__lojaPrisma = prisma;
}

/** Status do funil de CRM, na mesma ordem do painel. */
export const FUNNEL_STATUSES = [
  'NOVO',
  'MONTANDO_PC',
  'EM_QUALIFICACAO',
  'CARRINHO',
  'PIX_GERADO',
  'AGUARDANDO_NF',
  'CONCLUIDO',
] as const;

export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];

export const FUNNEL_STATUS_LABELS: Record<FunnelStatus, string> = {
  NOVO: 'Novo',
  MONTANDO_PC: 'Montando PC',
  EM_QUALIFICACAO: 'Em Qualificação',
  CARRINHO: 'Carrinho',
  PIX_GERADO: 'PIX Gerado',
  AGUARDANDO_NF: 'Aguardando NF',
  CONCLUIDO: 'Concluído',
};

export const FUNNEL_STATUS_COLORS: Record<FunnelStatus, string> = {
  NOVO: 'bg-slate-500',
  MONTANDO_PC: 'bg-blue-500',
  EM_QUALIFICACAO: 'bg-amber-500',
  CARRINHO: 'bg-violet-500',
  PIX_GERADO: 'bg-cyan-500',
  AGUARDANDO_NF: 'bg-orange-500',
  CONCLUIDO: 'bg-emerald-500',
};

export function isFunnelStatus(value: string): value is FunnelStatus {
  return (FUNNEL_STATUSES as readonly string[]).includes(value);
}
