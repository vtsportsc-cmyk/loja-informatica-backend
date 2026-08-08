import { z } from 'zod';

// ============================================================================
// PAGAMENTOS - PIX (QR Code / Copia e Cola) e Cartao de Credito (checkout)
// Schema para geracao de cobranca e recebimento de notificacoes (webhook).
// ============================================================================

export const paymentMethodSchema = z.enum(['pix', 'credit_card']);

export const currencySchema = z.string().regex(/^BRL$|^BRL$/);
export const moneySchema = z.number().int().positive().describe('valor em centavos (BRL)');

// --- Geracao de cobranca: requisicao ----------------------------------------
export const pixChargeRequestSchema = z.object({
  ticketId: z.string().min(1),
  orderId: z.string().min(1),
  amountCents: moneySchema,
  description: z.string().optional(),
  merchant: z
    .object({
      name: z.string().min(1),
      city: z.string().min(1),
      key: z.string().min(1),
    })
    .optional(),
  expiresInMinutes: z.number().int().positive().default(30),
});
export type PixChargeRequest = z.infer<typeof pixChargeRequestSchema>;

export const creditCardChargeRequestSchema = z.object({
  ticketId: z.string().min(1),
  orderId: z.string().min(1),
  amountCents: moneySchema,
  installments: z.number().int().min(1).max(12).default(1),
  card: z.object({
    holderName: z.string().min(1),
    number: z.string().regex(/^\d{13,19}$/),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2024),
    cvv: z.string().regex(/^\d{3,4}$/),
  }),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    document: z.string().min(11).max(14),
    phone: z.string().min(8),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreditCardChargeRequest = z.infer<typeof creditCardChargeRequestSchema>;

// --- Cobranca criada: resposta do provedor ----------------------------------
export const pixChargeCreatedSchema = z.object({
  chargeId: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(['pending', 'paid', 'expired']),
  qrCode: z.string().describe('base64 do QR Code para exibicao'),
  qrCodeBase64: z.string().describe('codigo base64 da imagem (copiar na mensagem)'),
  emv: z.string().describe('payload copia-e-cola (BR Code EMV)'),
  expiresAt: z.string(),
});
export type PixChargeCreated = z.infer<typeof pixChargeCreatedSchema>;

export const creditCardChargeCreatedSchema = z.object({
  chargeId: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(['authorized', 'pending', 'paid', 'refused']),
  installments: z.number().int(),
  brand: z.string().optional(),
  last4: z.string().optional(),
});
export type CreditCardChargeCreated = z.infer<typeof creditCardChargeCreatedSchema>;

export const chargeCreatedSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('pix'), charge: pixChargeCreatedSchema }),
  z.object({ method: z.literal('credit_card'), charge: creditCardChargeCreatedSchema }),
]);
export type ChargeCreated = z.infer<typeof chargeCreatedSchema>;

// --- Notificacao (webhook de confirmacao de pagamento) -----------------------
export const paymentNotificationSchema = z
  .object({
    event: z.enum(['payment.confirmed', 'payment.refused', 'payment.expired']),
    method: paymentMethodSchema,
    chargeId: z.string().min(1),
    orderId: z.string().min(1),
    ticketId: z.string().optional(),
    amountCents: moneySchema,
    paidAt: z.string().optional(),
    installments: z.number().int().optional(),
    pix: z
      .object({
        txid: z.string().optional(),
        endToEndId: z.string().optional(),
      })
      .optional(),
    signature: z.string().optional().describe('para validacao HMAC/Signature do webhook'),
  })
  .refine((v) => v.event !== 'payment.confirmed' || Boolean(v.paidAt), {
    message: 'payment.confirmed requer paidAt',
    path: ['paidAt'],
  });
export type PaymentNotification = z.infer<typeof paymentNotificationSchema>;

export const paymentNotificationAckSchema = z.object({
  received: z.literal(true),
  processed: z.boolean(),
  orderId: z.string(),
  status: z.enum(['awaiting_nf', 'ignored']),
});
export type PaymentNotificationAck = z.infer<typeof paymentNotificationAckSchema>;
