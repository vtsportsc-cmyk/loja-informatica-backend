import { KnowledgeBase } from '../rag/knowledgeBase.js';
import { FaqService } from '../rag/faq.js';
import { InstitutionalAnswerService } from '../rag/institutionalAnswers.js';
import { LLMProviderRouter } from '../llm/LLMProviderRouter.js';
import type { LlmChatMessage, LlmToolCall } from '../llm/types.js';
import { BotStateMachine } from '../fsm/BotStateMachine.js';
import type { TransitionResult } from '../fsm/BotStateMachine.js';
import { BotStateId } from '../fsm/states.js';
import { emitCrmEvent } from '../integrations/crm/CrmClient.js';
import type { ICrmClient } from '../integrations/crm/CrmClient.js';
import type { AgentBotResponse, AgentInbound, AgentTicketStatus } from '../types/index.js';
import { classifyIntent } from './skills/identifyIntent.js';
import type { AgentToolExecutor, OrderStatusInfo } from './ToolRegistry.js';
import type { CartResult, CompatibilityReport } from './ToolRegistry.js';
import { InMemorySessionStore } from './InMemorySessionStore.js';
import type { CustomerIntent, SessionState, SessionStore } from './types.js';
import { allowAllRateLimiter, type RateLimiter } from './rateLimiter.js';
import { SessionLock } from './sessionLock.js';
import { Metrics } from '../observability/metrics.js';

const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY_MESSAGES = 10;

// Diretrizes rigidas (Prompt Context Guard): regras nao negociáveis do agente.
// Mantidas fora do RAG para nunca serem diluidas pelo contexto injetado.
export const PROMPT_GUARD_RULES = `Diretrizes RIGIDAS do atendimento (nao negociáveis):
- NUNCA altere, invente ou informe precos de hardware que nao constem EXATAMENTE na base tecnica/FAQ desta mensagem. Se nao houver preco na base, diga que vai confirmar com o vendedor em vez de chutar.
- Respeite estritamente as regras de compatibilidade do "Monte seu PC": so recomende combinacoes de pecas validadas pela ferramenta check_hardware_compatibility; JAMAIS sugira uma montagem incompativel mesmo que o cliente insista.
- Em caso de duvida sobre PRAZOS (entrega, servico, emissao de NF) ou sobre GARANTIA, NÃO invente respostas: oriente o cliente a falar com um atendente humano (handoff).`;

export interface MessageHandlerOptions {
  router: LLMProviderRouter;
  tools: AgentToolExecutor;
  sessionStore?: SessionStore;
  knowledgeBase?: KnowledgeBase;
  /** Base de FAQs/politicas da loja injetada no contexto do LLM. */
  faqService?: FaqService;
  /** Respostas institucionais frequentes servidas direto do cache (zero tokens). */
  answerService?: InstitutionalAnswerService;
  /** Hook apos transicoes de FSM (ex.: gerar cobranca ao entrar em PAYMENT_PENDING). */
  onTransition?: (state: SessionState, fsm: BotStateMachine) => Promise<void> | void;
  /** Cliente CRM para eventos de ciclo de vida (lead.created); opcional. */
  crmClient?: ICrmClient;
  maxToolRounds?: number;
  rateLimiter?: RateLimiter;
  sessionLock?: SessionLock;
  metrics?: Metrics;
  logger?: (message: string) => void;
}

export class MessageHandler {
  private readonly router: LLMProviderRouter;
  private readonly tools: AgentToolExecutor;
  private readonly sessionStore: SessionStore;
  private readonly knowledgeBase: KnowledgeBase;
  private readonly faqService: FaqService;
  private readonly answerService?: InstitutionalAnswerService;
  private readonly onTransition?: MessageHandlerOptions['onTransition'];
  private readonly crmClient?: ICrmClient;
  private readonly maxToolRounds: number;
  private readonly rateLimiter: RateLimiter;
  private readonly sessionLock: SessionLock;
  private readonly metrics: Metrics;
  private readonly logger: (message: string) => void;

  constructor(options: MessageHandlerOptions) {
    this.router = options.router;
    this.tools = options.tools;
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore();
    this.knowledgeBase = options.knowledgeBase ?? new KnowledgeBase();
    this.faqService = options.faqService ?? new FaqService();
    this.answerService = options.answerService;
    this.onTransition = options.onTransition;
    this.crmClient = options.crmClient;
    this.maxToolRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
    this.rateLimiter = options.rateLimiter ?? allowAllRateLimiter;
    this.sessionLock = options.sessionLock ?? new SessionLock();
    this.metrics = options.metrics ?? new Metrics();
    this.logger = options.logger ?? ((m) => console.log(`[agent] ${m}`));
  }

  async processInbound(inbound: AgentInbound): Promise<AgentBotResponse> {
    const rateKey = `${inbound.customer.id}@${inbound.ticketId}`;
    const rate = this.rateLimiter.check(rateKey);
    if (!rate.allowed) {
      this.metrics.recordRateLimited(inbound.ticketId);
      return {
        reply: {
          ticketId: inbound.ticketId,
          channel: inbound.channel,
          type: 'text',
          text: 'Voce esta enviando mensagens rapidas demais. Aguarde um instante e tente de novo.',
        },
        ticketUpdate: {
          ticketId: inbound.ticketId,
          status: 'open',
          meta: { rateLimited: true },
        },
      };
    }

    const release = await this.sessionLock.acquire(inbound.ticketId);
    try {
      return await this.processLocked(inbound);
    } finally {
      release();
    }
  }

  private async processLocked(inbound: AgentInbound): Promise<AgentBotResponse> {
    const session = await this.loadOrCreate(inbound);
    const fsm = new BotStateMachine({
      initialState: session.botState,
      onTransition: (r) => {
        this.metrics.recordTransition(r.from, r.to);
        if (r.terminal) this.metrics.recordTerminalOutcome(r.to);
        this.emitLeadCreated(session, r);
      },
    });
    session.botState = fsm.current;

    // Observabilidade: consumo de tokens e tempo de geracao da resposta.
    const generationStarted = performance.now();
    let tokensUsed = 0;
    let provider = 'none';
    let model = '';
    let cached = false;

    let replyText: string | null = null;

    const cachedAnswer = await this.answerService?.tryAnswer(inbound.message.text ?? '');
    if (cachedAnswer) {
      replyText = cachedAnswer.text;
      provider = 'institutional';
      model = cachedAnswer.faqId;
      cached = true;
      this.metrics.recordInstitutionalAnswer(cachedAnswer.cached);
      this.logger(`[${inbound.ticketId}] resposta institucional via cache (${cachedAnswer.faqId}, cached=${cachedAnswer.cached}).`);
    } else {
      const messages = this.buildMessages(session, inbound);
      let rounds = 0;

      while (rounds < this.maxToolRounds) {
        const llmResult = await this.router.chat({
          messages,
          tools: this.tools.definitions,
          toolChoice: 'auto',
          temperature: 0.4,
        });
        rounds += 1;
        tokensUsed +=
          (llmResult.usage?.promptTokens ?? 0) + (llmResult.usage?.completionTokens ?? 0);
        provider = llmResult.provider;
        model = llmResult.model;

        if (llmResult.toolCalls.length === 0) {
          replyText = llmResult.content;
          break;
        }

        const assistantMessage: LlmChatMessage = {
          role: 'assistant',
          content: llmResult.content ?? '',
          name: 'assistant',
        };
        messages.push({ ...assistantMessage });

        for (const rawCall of llmResult.toolCalls) {
          const call = this.enrichToolCall(session, rawCall);
          const toolResult = await this.tools.execute(call);
          this.applyToolEffect(session, fsm, call.name, call.arguments, toolResult);
          messages.push({ role: 'tool', content: toolResult, toolCallId: call.id, name: call.name });
        }
      }

      if (replyText === null) {
        replyText =
          rounds >= this.maxToolRounds
            ? 'Estou com dificuldade para concluir a analise. Um vendedor vai te ajudar em instantes.'
            : 'Pode me dar mais detalhes do que voce procura?';
        fsm.transition({ type: 'HANDOFF', reason: 'max_tool_rounds' });
      }
    }

    const responseTimeMs = Math.round(performance.now() - generationStarted);

    if (this.onTransition) {
      await this.onTransition(session, fsm);
    }

    session.botState = fsm.current;
    this.recordMessages(session, inbound.message.text ?? '[media sem texto]', replyText);
    session.updatedAt = new Date().toISOString();
    await this.sessionStore.save(session);

    return {
      reply: {
        ticketId: inbound.ticketId,
        channel: inbound.channel,
        type: 'text',
        text: replyText,
        llm: {
          tokensUsed,
          responseTimeMs,
          provider,
          model,
          cached,
        },
      },
      ticketUpdate: {
        ticketId: inbound.ticketId,
        status: statusForState(fsm.current),
        meta: { botState: fsm.current, lockIds: session.lockIds },
      },
    };
  }

  /** Emite `lead.created` quando o cliente sai de boas-vindas para montagem/carrinho. */
  private emitLeadCreated(session: SessionState, r: TransitionResult): void {
    if (!this.crmClient) return;
    if (r.from !== BotStateId.GREETING || r.to !== BotStateId.HARDWARE_CHECK) return;
    emitCrmEvent(this.crmClient, {
      event: 'lead.created',
      ticketId: session.ticketId,
      customer: {
        id: session.customerId,
        name: session.customerName,
        phone: session.customerPhone ?? session.customerId,
      },
      intent: session.intent,
      wishlist: session.wishlist,
      estimatedValueCents: session.cart?.totalCents,
      createdAt: new Date().toISOString(),
    });
  }

  private async loadOrCreate(inbound: AgentInbound): Promise<SessionState> {
    const existing = await this.sessionStore.get(inbound.ticketId);
    if (existing) return existing;

    return {
      ticketId: inbound.ticketId,
      botState: BotStateId.GREETING,
      customerId: inbound.customer.id,
      customerName: inbound.customer.name,
      customerPhone: inbound.customer.phone,
      wishlist: [],
      cart: null,
      lockIds: [],
      recentMessages: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private recordMessages(
    session: SessionState,
    userText: string,
    assistantText: string,
  ): void {
    const history = session.recentMessages ?? [];
    const now = new Date().toISOString();
    history.push({ role: 'user', text: userText, at: now });
    if (assistantText) history.push({ role: 'assistant', text: assistantText, at: now });
    session.recentMessages = history.slice(-MAX_HISTORY_MESSAGES);
  }

  private buildMessages(session: SessionState, inbound: AgentInbound): LlmChatMessage[] {
    const kbContext = this.buildKnowledgeContext(session);
    const customerText = inbound.message.text ?? '[media sem texto]';
    const faqContext = this.buildFaqContext(customerText);

    const system = `Voce e o assistente comercial e de atendimento ao cliente da Loja de Informatica, atendendo pelo WhatsApp.
Sua atuacao e profissional e orientada a vendas, com foco em: TRIAGEM da conversa, TIRADA DE DUVIDAS com clareza, QUALIFICACAO de leads (o que o cliente precisa, orcamento e urgencia) e ENCAMINHAMENTO para a equipe comercial quando necessario.

Fluxo de atendimento:
1. Faca a triagem e identifique a necessidade do cliente (identify_intent).
2. Esclareca duvidas sobre produtos, compatibilidade, prazos, pagamento e servicos usando a base tecnica e os FAQs abaixo.
3. Qualifique o lead: finalidade (jogos/trabalho/estudo), pecas desejadas, faixa de orcamento e urgencia.
4. Faca a oferta: valide compatibilidade (check_hardware_compatibility), monte o carrinho com frete (calculate_cart) e feche com PIX ou cartao de credito.
5. Encaminhe ao comercial (handoff) quando o cliente pedir, quando houver objecao que voce nao possa resolver, duvida juridica/contratual ou pedido de atendimento/agendamento presencial.

Regras:
- Responda sempre em portugues (pt-BR), cordial, objetivo e sem gírias.
- Nunca invente especificacoes, precos ou promessas: use apenas a base tecnica e os FAQs fornecidos.
- Qualifique perguntando 1 ou 2 coisas por vez; nao encha o cliente de perguntas.
- Horario de atendimento, servicos, garantia e precos: responda com base nos FAQs.
- Ao confirmar um pagamento, informe que a separacao e a emissao da NF serao feitas pelo vendedor.
- Se o cliente perguntar o status de um pedido, use check_order_status com o ID informado.

${PROMPT_GUARD_RULES}

Contexto da sessao (ticket ${session.ticketId}):
- Estado atual do atendimento: ${session.botState}
- Intencao detectada: ${session.intent ?? 'ainda nao'}
- Wishlist: ${session.wishlist.length ? JSON.stringify(session.wishlist) : 'vazia'}
- Carrinho: ${session.cart ? `subtotal R$ ${(session.cart.subtotalCents / 100).toFixed(2)}, frete R$ ${(session.cart.freightCents / 100).toFixed(2)}, total R$ ${(session.cart.totalCents / 100).toFixed(2)}` : 'ainda nao montado'}
- Ultima checagem de compatibilidade: ${session.lastCompatibility ? (session.lastCompatibility.compatible ? 'compativel' : 'INCOMPATIVEL') : 'nenhuma'}
- Ultimo pedido rastreado: ${session.lastTrackedOrder ? `${session.lastTrackedOrder.orderId} (${session.lastTrackedOrder.status})` : 'nenhum'}
- Historico recente da conversa: ${session.recentMessages && session.recentMessages.length > 0 ? session.recentMessages.map((m) => `${m.role}: ${m.text}`).join(' | ') : '(sem historico)'}

Base tecnica (RAG):
${kbContext}

FAQs / politicas da loja:
${faqContext}`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: customerText },
    ];
  }

  private buildKnowledgeContext(session: SessionState): string {
    const queries = session.wishlist.length
      ? session.wishlist.map((w) => w.sku ?? w.description ?? '').filter(Boolean)
      : [];
    if (queries.length === 0) return '(sem dados na base)';

    const seen = new Set<string>();
    const lines: string[] = [];
    for (const query of queries) {
      const hits = this.knowledgeBase.search(query, 2);
      for (const hit of hits) {
        if (seen.has(hit.product.id)) continue;
        seen.add(hit.product.id);
        lines.push(
          `- ${hit.product.model} [${hit.product.category}] specs=${JSON.stringify(hit.product.specs)}`,
        );
      }
    }
    return lines.length ? lines.join('\n') : '(sem dados na base)';
  }

  /** Busca FAQs/politicas relevantes para o texto da mensagem do cliente. */
  private buildFaqContext(query: string): string {
    const hits = this.faqService.search(query, 3);
    if (hits.length === 0) return '(nenhuma FAQ relacionada)';
    return hits
      .map((f) => `- [${f.category}] ${f.question} -> ${f.answer}`)
      .join('\n');
  }

  /** Preenche dados de sessao ausentes na chamada de tool (fix: CEP do recalculo). */
  private enrichToolCall(session: SessionState, call: LlmToolCall): LlmToolCall {
    if (call.name === 'calculate_cart' && !call.arguments.zipCode && session.cart?.zipCode) {
      return { ...call, arguments: { ...call.arguments, zipCode: session.cart.zipCode } };
    }
    return call;
  }

  private applyToolEffect(
    session: SessionState,
    fsm: BotStateMachine,
    name: string,
    args: Record<string, unknown>,
    toolResult: string,
  ): void {
    switch (name) {
      case 'identify_intent': {
        const report = classifyIntent({
          intent: args['intent'] as CustomerIntent,
          wishlist: args['wishlist'] as never,
        });
        session.intent = report.intent;
        if (report.wishlist.length > 0) session.wishlist = report.wishlist;

        if (report.intent === 'handoff') {
          fsm.transition({ type: 'HANDOFF', reason: String(args['reason'] ?? 'cliente_pediu') });
        } else if (report.intent === 'track_order' && fsm.canTransition('TRACK_ORDER')) {
          fsm.transition({ type: 'TRACK_ORDER' });
        } else if (report.intent === 'purchase' && fsm.canTransition('INTENT_PURCHASE')) {
          fsm.transition({ type: 'INTENT_PURCHASE' });
        }
        break;
      }
      case 'check_hardware_compatibility': {
        if (fsm.canTransition('INTENT_PURCHASE')) {
          fsm.transition({ type: 'INTENT_PURCHASE' });
        }
        const report = JSON.parse(toolResult) as CompatibilityReport;
        session.lastCompatibility = report;
        if (report.compatible && fsm.current === BotStateId.HARDWARE_CHECK) {
          fsm.transition({ type: 'SPECS_CONFIRMED' });
        }
        break;
      }
      case 'calculate_cart': {
        if (fsm.canTransition('INTENT_PURCHASE')) {
          fsm.transition({ type: 'INTENT_PURCHASE' });
        }
        if (fsm.current === BotStateId.HARDWARE_CHECK) {
          fsm.transition({ type: 'SPECS_CONFIRMED' });
        }
        const cart = JSON.parse(toolResult) as CartResult;
        session.cart = cart;
        session.lockIds = Array.from(
          new Set([
            ...session.lockIds,
            ...cart.lines
              .map((l) => l.lockId)
              .filter((id): id is string => Boolean(id)),
          ]),
        );
        if (cart.outOfStockSkus.length === 0 && fsm.current === BotStateId.STOCK_AND_FREIGHT) {
          fsm.transition({ type: 'CART_READY' });
        }
        break;
      }
      case 'check_order_status': {
        const payload = JSON.parse(toolResult) as { ok: boolean; order?: OrderStatusInfo };
        if (payload.ok && payload.order) {
          session.lastTrackedOrder = payload.order;
        }
        break;
      }
      default:
        break;
    }
  }
}

function statusForState(state: BotStateId): AgentTicketStatus {
  switch (state) {
    case BotStateId.PAYMENT_PENDING:
      return 'awaiting_payment';
    case BotStateId.PAYMENT_CONFIRMED:
      return 'payment_confirmed';
    case BotStateId.HANDOFF:
      return 'pending_agent';
    default:
      return 'open';
  }
}
