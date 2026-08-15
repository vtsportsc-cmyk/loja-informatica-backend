import { z } from 'zod';

// ============================================================================
// Tipos neutros do motor de atendimento (substituem o antigo contrato SURI).
// Entrada normalizada a partir do webhook da Evolution API (WhatsApp) e saida
// (resposta automatica) que a EvolutionApi envia de volta ao cliente.
// ============================================================================

export const agentChannelSchema = z.enum(['whatsapp', 'web', 'email']);

export const agentMessageTypeSchema = z.enum([
  'text',
  'image',
  'audio',
  'document',
  'video',
  'sticker',
  'button',
  'list_reply',
]);

export const agentCustomerSchema = z.object({
  id: z.string().min(1),
  phone: z.string().min(1),
  name: z.string().optional(),
  waId: z.string().optional(),
  profilePic: z.string().optional(),
});

export const agentMessageSchema = z.object({
  id: z.string().min(1),
  type: agentMessageTypeSchema,
  text: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaMimeType: z.string().optional(),
  caption: z.string().optional(),
  buttonPayload: z.string().optional(),
  listRowId: z.string().optional(),
  timestamp: z.string(),
});

export const agentContextSchema = z.object({
  ticketId: z.string().optional(),
  contactId: z.string().optional(),
  conversationId: z.string().optional(),
  locale: z.string().default('pt-BR'),
  timezone: z.string().default('America/Sao_Paulo'),
});

// --- Entrada: mensagem do cliente normalizada (via Evolution API) -----------
export const agentInboundSchema = z.object({
  event: z.enum(['message', 'ticket.opened', 'ticket.closed', 'handoff']).default('message'),
  channel: agentChannelSchema,
  ticketId: z.string().min(1),
  customer: agentCustomerSchema,
  message: agentMessageSchema,
  context: agentContextSchema.optional(),
  receivedAt: z.string(),
});
export type AgentInbound = z.infer<typeof agentInboundSchema>;

// --- Saida: resposta automatica enviada de volta ao cliente -----------------
export const agentReplySchema = z.object({
  ticketId: z.string().min(1),
  channel: agentChannelSchema,
  type: agentMessageTypeSchema,
  text: z.string().min(1),
  quickReplies: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  attachmentUrl: z.string().optional(),
  // Observabilidade: metricas de geracao da resposta pela IA (tokens/latencia).
  llm: z
    .object({
      tokensUsed: z.number().int().nonnegative(),
      responseTimeMs: z.number().int().nonnegative(),
      provider: z.string(),
      model: z.string(),
      cached: z.boolean(),
    })
    .optional(),
});
export type AgentReply = z.infer<typeof agentReplySchema>;

// --- Status da conversa (mapeado para o funil/CRM) --------------------------
export const agentTicketStatusSchema = z.enum([
  'open',
  'pending_agent',
  'awaiting_payment',
  'payment_confirmed',
  'awaiting_nf',
  'closed',
]);
export type AgentTicketStatus = z.infer<typeof agentTicketStatusSchema>;

export const agentTicketUpdateSchema = z.object({
  ticketId: z.string().min(1),
  status: agentTicketStatusSchema,
  note: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type AgentTicketUpdate = z.infer<typeof agentTicketUpdateSchema>;

// Payload combinado: o que o motor devolve para a camada de envio processar.
export const agentBotResponseSchema = z.object({
  reply: agentReplySchema,
  ticketUpdate: agentTicketUpdateSchema.optional(),
});
export type AgentBotResponse = z.infer<typeof agentBotResponseSchema>;

// Handoff para humano: quando a IA nao consegue resolver.
export const agentHandoffSchema = z.object({
  ticketId: z.string().min(1),
  reason: z.enum(['unclear', 'out_of_scope', 'payment_issue', 'vendedor_manual']),
  summary: z.string(),
  suggestedAgentQueue: z.string().optional(),
});
export type AgentHandoff = z.infer<typeof agentHandoffSchema>;
