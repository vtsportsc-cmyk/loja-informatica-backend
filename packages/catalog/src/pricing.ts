import type { BuildSelection, HardwareProduct } from './types.js';

// Politica comercial do Monte seu PC: 5% de desconto no PIX e
// parcelamento em ate 12x com taxa mensal de 1,99% (a.p.).
export const PIX_DISCOUNT_PERCENT = 5;
export const MAX_INSTALLMENTS = 12;
export const INSTALLMENT_MONTHLY_RATE = 0.0199;

export function totalCents(selection: BuildSelection): number {
  return Object.values(selection).reduce((sum, p) => sum + (p?.priceCents ?? 0), 0);
}

export function pixTotalCents(total: number): number {
  return Math.round(total * (1 - PIX_DISCOUNT_PERCENT / 100));
}

export function discountCents(total: number): number {
  return total - pixTotalCents(total);
}

export interface InstallmentPlan {
  installments: number;
  monthlyValueCents: number;
  totalCents: number;
}

export function parceledPlan(total: number): InstallmentPlan {
  const factor = Math.pow(1 + INSTALLMENT_MONTHLY_RATE, MAX_INSTALLMENTS);
  const totalWithInterest = Math.round(total * factor);
  return {
    installments: MAX_INSTALLMENTS,
    monthlyValueCents: Math.round(totalWithInterest / MAX_INSTALLMENTS),
    totalCents: totalWithInterest,
  };
}

export interface PriceSummary {
  subtotalCents: number;
  discountCents: number;
  pixTotalCents: number;
  installmentPlan: InstallmentPlan;
}

export function summarize(selection: BuildSelection): PriceSummary {
  const subtotal = totalCents(selection);
  return {
    subtotalCents: subtotal,
    discountCents: discountCents(subtotal),
    pixTotalCents: pixTotalCents(subtotal),
    installmentPlan: parceledPlan(subtotal),
  };
}

// ---------------------------------------------------------------------------
// Utilidades de formatacao compartilhadas (frontend).
// ---------------------------------------------------------------------------
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export const CATEGORY_LABELS: Record<HardwareProduct['category'], string> = {
  cpu: 'Processador',
  motherboard: 'Placa-Mãe',
  memory: 'Memória RAM',
  gpu: 'Placa de Vídeo',
  storage: 'Armazenamento',
  psu: 'Fonte de Alimentação',
  case: 'Gabinete',
  cooler: 'Refrigeração',
};
