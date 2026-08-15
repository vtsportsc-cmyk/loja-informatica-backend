// Metadados de origem do lead e motivo de perda, client-safe (nao importa
// @loja/db, que instancia o PrismaClient no modulo). Mantido em sintonia com
// packages/db/src/index.ts.
export const LEAD_SOURCES = ['BUILDER', 'WHATSAPP_DIRECT', 'INDICACAO', 'BALCAO'] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  BUILDER: 'Monte seu PC',
  WHATSAPP_DIRECT: 'WhatsApp direto',
  INDICACAO: 'Indicação',
  BALCAO: 'Balcão',
};

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
