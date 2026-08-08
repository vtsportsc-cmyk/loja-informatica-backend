import { z } from 'zod';

// ============================================================================
// SURI - Plataforma de atendimento WhatsApp
// Documentacao de referencia: payloads de entrada (mensagem do cliente) e
// saida (resposta automatica / alteracao de status do ticket).
// ============================================================================

export const suriChannelSchema = z.enum(['whatsapp', 'web', 'email']);

export const suriMessageTypeSchema = z.enum(['text', 'image', 'button', 'list_reply']);

export const suriCustomerSchema = z.object({
  id: z.string().min(1),
  phone: z.string().min(1),
  name: z.string().optional(),
  waId: z.string().optional(),
  profilePic: z.string().optional(),
});

export const suriMessageSchema = z.object({
  id: z.string().min(1),
  type: suriMessageTypeSchema,
  text: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional(),
  buttonPayload: z.string().optional(),
  listRowId: z.string().optional(),
  timestamp: z.string(),
});

export const suriContextSchema = z.object({
  ticketId: z.string().optional(),
  contactId: z.string().optional(),
  conversationId: z.string().optional(),
  locale: z.string().default('pt-BR'),
  timezone: z.string().default('America/Sao_Paulo'),
});

// --- Entrada: mensagem do cliente recebida no webhook -----------------------
export const suriInboundSchema = z.object({
  event: z.enum(['message', 'ticket.opened', 'ticket.closed', 'handoff']).default('message'),
  channel: suriChannelSchema,
  ticketId: z.string().min(1),
  customer: suriCustomerSchema,
  message: suriMessageSchema,
  context: suriContextSchema.optional(),
  receivedAt: z.string(),
});
export type SuriInbound = z.infer<typeof suriInboundSchema>;

// --- Saida: resposta automatica enviada de volta ao cliente -----------------
export const suriReplySchema = z.object({
  ticketId: z.string().min(1),
  channel: suriChannelSchema,
  type: suriMessageTypeSchema,
  text: z.string().min(1),
  quickReplies: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  attachmentUrl: z.string().url().optional(),
});
export type SuriReply = z.infer<typeof suriReplySchema>;

// --- Status do ticket (para alterar o estado no SURI) -----------------------
export const suriTicketStatusSchema = z.enum([
  'open',
  'pending_agent',
  'awaiting_payment',
  'payment_confirmed',
  'awaiting_nf',
  'closed',
]);
export type SuriTicketStatus = z.infer<typeof suriTicketStatusSchema>;

export const suriTicketUpdateSchema = z.object({
  ticketId: z.string().min(1),
  status: suriTicketStatusSchema,
  note: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type SuriTicketUpdate = z.infer<typeof suriTicketUpdateSchema>;

// Payload combinado: o que o motor devolve para o SURI processar.
export const suriBotResponseSchema = z.object({
  reply: suriReplySchema,
  ticketUpdate: suriTicketUpdateSchema.optional(),
});
export type SuriBotResponse = z.infer<typeof suriBotResponseSchema>;

// Handoff para humano: quando a IA nao consegue resolver.
export const suriHandoffSchema = z.object({
  ticketId: z.string().min(1),
  reason: z.enum(['unclear', 'out_of_scope', 'payment_issue', 'vendedor_manual']),
  summary: z.string(),
  suggestedAgentQueue: z.string().optional(),
});
export type SuriHandoff = z.infer<typeof suriHandoffSchema>;
