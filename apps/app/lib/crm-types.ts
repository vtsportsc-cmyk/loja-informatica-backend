// Tipos compartilhados entre os subcomponentes do CRM (Kanban, Analytics, etc.).
// Extraidos de app/crm/page.tsx para evitar duplicacao de interfaces.

import { FUNNEL_STATUS_COLORS, FUNNEL_STATUS_PILL } from './funnel';

export interface QuoteItem {
  sku: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface QuoteSummary {
  code: string;
  totalCents: number;
  pixTotalCents: number;
  installments: number;
  monthlyValueCents: number;
  parceledTotalCents: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  blingOrderId: string | null;
  blingNumber: string | null;
  blingStatus: string | null;
  items: QuoteItem[];
}

export interface Conversation {
  id: string;
  whatsappId: string;
  customerName: string | null;
  funnelStatus: string;
  department: string | null;
  leadSource: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  lostReason: string | null;
  lostAt: string | null;
  lastFollowUpAt: string | null;
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  quote?: QuoteSummary | null;
}

export interface Agent {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  active: boolean;
}

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  agentId: string | null;
  text: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers compartilhados
// ---------------------------------------------------------------------------

export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function statusPill(status: string): string {
  return FUNNEL_STATUS_PILL[status as keyof typeof FUNNEL_STATUS_PILL] ?? 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/30';
}

export function statusDot(status: string): string {
  return FUNNEL_STATUS_COLORS[status as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500';
}
