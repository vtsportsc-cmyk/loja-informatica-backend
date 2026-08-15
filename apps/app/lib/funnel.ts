// Metadados do funil de CRM, client-safe (nao importa @loja/db, que instancia
// o PrismaClient no modulo). Mantido em sintonia com packages/db/src/index.ts.
export const FUNNEL_STATUSES = [
  'NOVO',
  'MONTANDO_PC',
  'EM_QUALIFICACAO',
  'ALTA_VALOR',
  'CARRINHO',
  'PIX_GERADO',
  'AGUARDANDO_NF',
  'CONCLUIDO',
  'CANCELADO',
] as const;

export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];

export const FUNNEL_STATUS_LABELS: Record<FunnelStatus, string> = {
  NOVO: 'Novo',
  MONTANDO_PC: 'Montando PC',
  EM_QUALIFICACAO: 'Em Qualificação',
  ALTA_VALOR: 'Alto Valor',
  CARRINHO: 'Carrinho',
  PIX_GERADO: 'PIX Gerado',
  AGUARDANDO_NF: 'Aguardando NF',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado / Perdido',
};

export const FUNNEL_STATUS_COLORS: Record<FunnelStatus, string> = {
  NOVO: 'bg-slate-500',
  MONTANDO_PC: 'bg-blue-500',
  EM_QUALIFICACAO: 'bg-amber-500',
  ALTA_VALOR: 'bg-rose-500',
  CARRINHO: 'bg-violet-500',
  PIX_GERADO: 'bg-cyan-500',
  AGUARDANDO_NF: 'bg-orange-500',
  CONCLUIDO: 'bg-emerald-500',
  CANCELADO: 'bg-red-600',
};

/** Pill pronto para Tailwind: fundo + texto + anel da mesma cor (estado do funil). */
export const FUNNEL_STATUS_PILL: Record<FunnelStatus, string> = {
  NOVO: 'bg-slate-500/10 text-slate-300 ring-slate-500/30',
  MONTANDO_PC: 'bg-blue-500/10 text-blue-300 ring-blue-500/30',
  EM_QUALIFICACAO: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  ALTA_VALOR: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  CARRINHO: 'bg-violet-500/10 text-violet-300 ring-violet-500/30',
  PIX_GERADO: 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/30',
  AGUARDANDO_NF: 'bg-orange-500/10 text-orange-300 ring-orange-500/30',
  CONCLUIDO: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  CANCELADO: 'bg-red-500/10 text-red-300 ring-red-500/30',
};
