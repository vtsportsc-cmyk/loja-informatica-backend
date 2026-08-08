import { z } from 'zod';

export const identifyIntentRequestSchema = z.object({
  intent: z.enum([
    'purchase',
    'hardware_check',
    'cart_quote',
    'payment_status',
    'track_order',
    'greeting',
    'handoff',
  ]),
  wishlist: z
    .array(
      z.object({
        sku: z.string().optional().describe('SKU se mencionado pelo cliente'),
        description: z.string().describe('descricao do produto desejado'),
        quantity: z.number().int().min(1).default(1),
      }),
    )
    .optional(),
});
export type IdentifyIntentRequest = z.infer<typeof identifyIntentRequestSchema>;

export interface IntentReport {
  intent: IdentifyIntentRequest['intent'];
  wishlist: NonNullable<IdentifyIntentRequest['wishlist']>;
}

export function classifyIntent(request: IdentifyIntentRequest): IntentReport {
  return {
    intent: request.intent,
    wishlist: request.wishlist ?? [],
  };
}
