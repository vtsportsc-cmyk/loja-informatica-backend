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
  ALTA_VALOR: 'Oportunidade de Alto Valor',
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

export function isFunnelStatus(value: string): value is FunnelStatus {
  return (FUNNEL_STATUSES as readonly string[]).includes(value);
}

/** Origens do lead do CRM (Monte seu PC / WhatsApp / indicação / balcão / Instagram). */
export const LEAD_SOURCES = ['BUILDER', 'WHATSAPP_DIRECT', 'INDICACAO', 'BALCAO', 'INSTAGRAM'] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  BUILDER: 'Monte seu PC',
  WHATSAPP_DIRECT: 'WhatsApp direto',
  INDICACAO: 'Indicação',
  BALCAO: 'Balcão',
  INSTAGRAM: 'Instagram',
};

export function isLeadSource(value: string): value is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(value);
}

/** Motivos de perda do lead (status CANCELADO / PERDIDO). */
export const LOST_REASONS = [
  'PRECO_ALTO',
  'CONCORRENTE',
  'FORA_DE_ESTOQUE',
  'SEM_RESPOSTA',
  'OUTRO',
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  PRECO_ALTO: 'Preço alto',
  CONCORRENTE: 'Escolheu concorrente',
  FORA_DE_ESTOQUE: 'Fora de estoque',
  SEM_RESPOSTA: 'Sem resposta',
  OUTRO: 'Outro',
};

export function isLostReason(value: string): value is LostReason {
  return (LOST_REASONS as readonly string[]).includes(value);
}

/** Departamentos de atendimento do CRM (filas), na mesma ordem do painel. */
export const DEPARTMENTS = ['VENDAS', 'SUPORTE', 'MONTAGEM'] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  VENDAS: 'Vendas',
  SUPORTE: 'Suporte',
  MONTAGEM: 'Montagem',
};

export const DEPARTMENT_COLORS: Record<Department, string> = {
  VENDAS: 'bg-brand',
  SUPORTE: 'bg-blue-500',
  MONTAGEM: 'bg-violet-500',
};

export function isDepartment(value: string): value is Department {
  return (DEPARTMENTS as readonly string[]).includes(value);
}
