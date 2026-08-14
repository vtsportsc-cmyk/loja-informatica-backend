import { z } from 'zod';
import type { StockItem, StockLock } from '../../types/index.js';
import type { CartSummary } from '../types.js';

// ============================================================================
// Skill: cart_calculator
// Extrai os SKUs solicitados no chat, consulta estoque no ERP, aplica frete,
// trava os itens por 15 min (checkout) e monta o valor final.
// ============================================================================

export const cartCalculatorRequestSchema = z.object({
  skus: z
    .array(
      z.object({
        sku: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/),
        quantity: z.number().int().min(1).default(1),
      }),
    )
    .min(1),
  zipCode: z.string().regex(/^\d{8}$/).optional().describe('CEP para calculo de frete'),
  lockItems: z.boolean().default(true).describe('trava estoque por 15 min no checkout'),
});
export type CartCalculatorRequest = z.infer<typeof cartCalculatorRequestSchema>;

export interface CartLineResult {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  available: boolean;
  lockId?: string;
  lockExpiresAt?: string;
  outOfStock: boolean;
}

export interface CartResult extends CartSummary {
  lines: CartLineResult[];
  zipCode?: string;
  outOfStockSkus: string[];
  freightDetail?: { method: string; estimatedDays: number; cep: string };
}

export interface ErpAdapter {
  stockBySku(sku: string): Promise<StockItem | null>;
  lockItem(sku: string, quantity: number): Promise<StockLock>;
}

export interface FreightCalculator {
  (zipCode: string, subtotalCents: number): Promise<{
    freightCents: number;
    estimatedDays: number;
    method: string;
  }>;
}

const LOCK_TTL_MS = 15 * 60 * 1000;

export class CartCalculatorSkill {
  private readonly erp: ErpAdapter;
  private readonly freight: FreightCalculator;

  constructor(erp: ErpAdapter, freight: FreightCalculator) {
    this.erp = erp;
    this.freight = freight;
  }

  async run(request: CartCalculatorRequest): Promise<CartResult> {
    const lines: CartLineResult[] = [];
    const outOfStockSkus: string[] = [];

    for (const line of request.skus) {
      const item = await this.erp.stockBySku(line.sku);

      if (!item || !item.active) {
        lines.push({
          sku: line.sku,
          name: 'Desconhecido',
          quantity: line.quantity,
          unitPriceCents: 0,
          subtotalCents: 0,
          available: false,
          outOfStock: true,
        });
        outOfStockSkus.push(line.sku);
        continue;
      }

      const available = item.available >= line.quantity;
      if (!available) {
        lines.push({
          sku: line.sku,
          name: item.name,
          quantity: line.quantity,
          unitPriceCents: item.priceCents,
          subtotalCents: item.priceCents * line.quantity,
          available: false,
          outOfStock: true,
        });
        outOfStockSkus.push(line.sku);
        continue;
      }

      let lockId: string | undefined;
      let lockExpiresAt: string | undefined;
      if (request.lockItems) {
        const lock = await this.erp.lockItem(line.sku, line.quantity);
        lockId = lock.lockId;
        lockExpiresAt = lock.expiresAt;
      } else {
        lockExpiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
      }

      lines.push({
        sku: line.sku,
        name: item.name,
        quantity: line.quantity,
        unitPriceCents: item.priceCents,
        subtotalCents: item.priceCents * line.quantity,
        available: true,
        lockId,
        lockExpiresAt,
        outOfStock: false,
      });
    }

    const subtotalCents = lines.reduce((sum, l) => sum + l.subtotalCents, 0);

    let freightCents = 0;
    let freightDetail: CartResult['freightDetail'];
    if (request.zipCode) {
      const freight = await this.freight(request.zipCode, subtotalCents);
      freightCents = freight.freightCents;
      freightDetail = { ...freight, cep: request.zipCode };
    }

    const items = lines
      .filter((l) => !l.outOfStock)
      .map((l) => ({
        sku: l.sku,
        name: l.name,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        lockId: l.lockId,
        lockExpiresAt: l.lockExpiresAt,
      }));

    return {
      items,
      lines,
      subtotalCents,
      freightCents,
      totalCents: subtotalCents + freightCents,
      zipCode: request.zipCode,
      outOfStockSkus,
      freightDetail,
    };
  }
}

// Calculadora de frete padrao (regra simples por faixa de CEP).
export const defaultFreightCalculator: FreightCalculator = async (zipCode, subtotalCents) => {
  const region = zipCode[0];
  const isCapitol = zipCode[1] === '0';
  const freightCents = region === '0' || region === '1' || region === '2' ? 2500 : 4000;
  return {
    freightCents: isCapitol ? freightCents : freightCents + 1200,
    estimatedDays: region === '0' || region === '1' ? 2 : 5,
    method: 'PAC',
  };
};
