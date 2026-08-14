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
};
