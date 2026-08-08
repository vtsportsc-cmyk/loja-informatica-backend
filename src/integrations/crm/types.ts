import { z } from 'zod';

// ============================================================================
// CRM (trycompai/crm) - eventos de ciclo de vida da venda + webhook de
// follow-up (reengajamento). Toda tipagem de entrada/saida e rigorosa via Zod.
// ============================================================================

export const crmEventNameSchema = z.enum([
  'lead.created',
  'pix.generated',
  'pix.expired',
  'sale.completed',
]);
export type CrmEventName = z.infer<typeof crmEventNameSchema>;

const crmCustomerSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  phone: z.string().min(1),
});

const crmWishItemSchema = z.object({
  sku: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().int().positive(),
});

// --- lead.created: cliente saiu de boas-vindas para montagem/carrinho --------
export const crmLeadCreatedSchema = z.object({
  event: z.literal('lead.created'),
  ticketId: z.string().min(1),
  customer: crmCustomerSchema,
  intent: z.string().optional(),
  wishlist: z.array(crmWishItemSchema).optional(),
  estimatedValueCents: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
});
export type CrmLeadCreated = z.infer<typeof crmLeadCreatedSchema>;

// --- pix.generated: cobranca PIX criada no estado de pagamento ---------------
export const crmPixGeneratedSchema = z.object({
  event: z.literal('pix.generated'),
  ticketId: z.string().min(1),
  orderId: z.string().min(1),
  chargeId: z.string().min(1),
  amountCents: z.number().int().positive(),
  qrCodeBase64: z.string().optional(),
  emv: z.string().optional(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type CrmPixGenerated = z.infer<typeof crmPixGeneratedSchema>;

// --- pix.expired: cobranca expirou sem pagamento (paymentExpiryJob) ----------
export const crmPixExpiredSchema = z.object({
  event: z.literal('pix.expired'),
  ticketId: z.string().min(1),
  chargeId: z.string().optional(),
  orderId: z.string().optional(),
  amountCents: z.number().int().nonnegative().optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
});
export type CrmPixExpired = z.infer<typeof crmPixExpiredSchema>;

// --- sale.completed: pagamento validado e pedido criado (aguardando_nf) ------
export const crmSaleCompletedSchema = z.object({
  event: z.literal('sale.completed'),
  ticketId: z.string().min(1),
  orderId: z.string().min(1),
  chargeId: z.string().min(1),
  amountCents: z.number().int().positive(),
  method: z.enum(['pix', 'credit_card']),
  createdAt: z.string(),
});
export type CrmSaleCompleted = z.infer<typeof crmSaleCompletedSchema>;

export const crmEventSchema = z.discriminatedUnion('event', [
  crmLeadCreatedSchema,
  crmPixGeneratedSchema,
  crmPixExpiredSchema,
  crmSaleCompletedSchema,
]);
export type CrmEvent = z.infer<typeof crmEventSchema>;

export const crmSendResultSchema = z.object({
  delivered: z.boolean(),
  event: crmEventNameSchema,
  statusCode: z.number().int().optional(),
  skipped: z.enum(['disabled']).optional(),
});
export type CrmSendResult = z.infer<typeof crmSendResultSchema>;

// --- Follow-up (webhook do "Agente Duradouro" do CRM) ------------------------
export const crmFollowUpReasonSchema = z.enum([
  'abandoned_cart',
  'pix_expired_followup',
  'manual',
]);
export type CrmFollowUpReason = z.infer<typeof crmFollowUpReasonSchema>;

export const crmFollowUpSchema = z.object({
  ticketId: z.string().min(1),
  customerId: z.string().optional(),
  message: z.string().min(1).optional(),
  reason: crmFollowUpReasonSchema.optional(),
});
export type CrmFollowUp = z.infer<typeof crmFollowUpSchema>;
