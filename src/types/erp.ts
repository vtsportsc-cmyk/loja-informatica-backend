import { z } from 'zod';

// ============================================================================
// API do ERP - consulta de estoque por SKU, trava temporaria de item
// (reserva de 15 min no checkout) e criacao de pedido ("Aguardando NF").
// ============================================================================

export const skuSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/);

export const quantitySchema = z.number().int().min(1);

export const stockUnitSchema = z.enum(['un', 'kit', 'kg']);

export const moneyCentsSchema = z.number().int().nonnegative();

// --- Consulta de estoque por SKU --------------------------------------------
export const stockQuerySchema = z.object({
  sku: skuSchema,
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

export const stockItemSchema = z.object({
  sku: skuSchema,
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: stockUnitSchema.default('un'),
  available: z.number().int().min(0),
  reserved: z.number().int().min(0),
  priceCents: moneyCentsSchema,
  costCents: moneyCentsSchema.optional(),
  specs: z.record(z.string(), z.string()).optional().describe('ex: socket, tdpW, memoryType'),
  active: z.boolean().default(true),
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const stockQueryResponseSchema = z.object({
  item: stockItemSchema.nullable(),
  lastUpdatedAt: z.string(),
});
export type StockQueryResponse = z.infer<typeof stockQueryResponseSchema>;

// --- Trava temporaria de item (reserva de 15 min no checkout) ---------------
export const stockLockRequestSchema = z.object({
  sku: skuSchema,
  quantity: quantitySchema,
  lockToken: z.string().min(1).optional().describe('reenviar para renovar a mesma trava'),
  ttlSeconds: z.number().int().positive().max(3600).default(900).describe('default 15 min'),
  reason: z.enum(['checkout', 'payment_pending', 'manual']).default('checkout'),
});
export type StockLockRequest = z.infer<typeof stockLockRequestSchema>;

export const stockLockSchema = z.object({
  lockId: z.string().min(1),
  sku: skuSchema,
  quantity: quantitySchema,
  status: z.enum(['active', 'renewed', 'expired', 'released']),
  expiresAt: z.string(),
});
export type StockLock = z.infer<typeof stockLockSchema>;

export const stockReleaseRequestSchema = z.object({
  lockId: z.string().min(1),
  reason: z.enum(['payment_confirmed', 'cancelled', 'timeout']).default('cancelled'),
});
export type StockReleaseRequest = z.infer<typeof stockReleaseRequestSchema>;

// --- Criacao de pedido ("Aguardando NF") ------------------------------------
export const orderLineSchema = z.object({
  sku: skuSchema,
  quantity: quantitySchema,
  unitPriceCents: moneyCentsSchema,
  lockId: z.string().min(1).describe('trava originada no checkout'),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderCreateRequestSchema = z.object({
  ticketId: z.string().min(1),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(8),
    document: z.string().optional(),
    email: z.string().email().optional(),
    address: z
      .object({
        zip: z.string().min(8),
        street: z.string().min(1),
        number: z.string().min(1),
        complement: z.string().optional(),
        city: z.string().min(1),
        state: z.string().length(2),
      })
      .optional(),
  }),
  lines: z.array(orderLineSchema).min(1),
  shipping: z
    .object({
      carrier: z.string().optional(),
      method: z.string().optional(),
      freightCents: moneyCentsSchema,
      deliveryEstimateDays: z.number().int().min(1).optional(),
    })
    .optional(),
  paymentMethod: z.enum(['pix', 'credit_card']),
  status: z.literal('awaiting_nf'),
  totalCents: moneyCentsSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type OrderCreateRequest = z.infer<typeof orderCreateRequestSchema>;

export const orderSchema = z.object({
  orderId: z.string().min(1),
  ticketId: z.string().min(1),
  status: z.enum(['awaiting_nf', 'nf_issued', 'shipped', 'delivered', 'cancelled']),
  totalCents: moneyCentsSchema,
  paymentMethod: z.enum(['pix', 'credit_card']),
  createdAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;
