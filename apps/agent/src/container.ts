import { prisma as defaultPrisma } from '@loja/db';
import type { PrismaClient } from '@loja/db';
import { loadEnv } from './config/env.js';
import { LLMProviderRouter } from './llm/LLMProviderRouter.js';
import type { ProviderChangeEvent } from './llm/LLMProviderRouter.js';
import { KnowledgeBase } from './rag/knowledgeBase.js';
import { MessageHandler } from './agent/MessageHandler.js';
import { InMemorySessionStore } from './agent/InMemorySessionStore.js';
import { RedisSessionStore } from './agent/RedisSessionStore.js';
import type { RedisLike } from './agent/RedisSessionStore.js';
import type { ISessionStore } from './agent/types.js';
import { SlidingWindowRateLimiter } from './agent/rateLimiter.js';
import { SessionLock } from './agent/sessionLock.js';
import {
  createPaymentExpiryJob,
  type PaymentExpiryJob,
} from './agent/paymentExpiryJob.js';
import {
  CartCalculatorSkill,
  defaultFreightCalculator,
  HardwareCompatibilitySkill,
  ProductSpecResolver,
  ToolRegistry,
} from './agent/ToolRegistry.js';
import type { OrderStatusInfo } from './agent/ToolRegistry.js';
import { BotStateId } from './fsm/states.js';
import { ErpClient } from './integration/erp/ErpClient.js';
import { PaymentClient } from './integration/payment/PaymentClient.js';
import { PaymentWebhookProcessor } from './integration/payment/PaymentWebhookProcessor.js';
import { EvolutionApi } from './integration/evolution/EvolutionApi.js';
import { BlingClient } from './integration/bling/BlingClient.js';
import { BlingOrderService } from './integration/bling/BlingOrderService.js';
import {
  PrismaMessageRepository,
  InMemoryMessageRepository,
  type IMessageRepository,
} from './prisma/MessageRepository.js';
import { EvolutionWebhookHandler } from './webhooks/evolution.js';
import { PanelApi } from './panel/PanelApi.js';
import { CrmClient } from './integrations/crm/CrmClient.js';
import type { ICrmClient } from './integrations/crm/CrmClient.js';
import { CrmFollowUpHandler } from './webhooks/crm.js';
import { createChargeOnTransition } from './agent/chargeOnTransition.js';
import { Metrics } from './observability/metrics.js';
import type { StockItem } from './types/index.js';

export interface AppContainer {
  router: LLMProviderRouter;
  handler: MessageHandler;
  erp: ErpClient;
  payment: PaymentClient;
  paymentWebhook: PaymentWebhookProcessor;
  evolution: EvolutionApi;
  crm: ICrmClient;
  crmFollowUp: CrmFollowUpHandler;
  sessionStore: ISessionStore;
  knowledgeBase: KnowledgeBase;
  metrics: Metrics;
  paymentExpiryJob: PaymentExpiryJob;
  repository: IMessageRepository;
  evolutionWebhook?: EvolutionWebhookHandler;
  panelApi?: PanelApi;
}

export interface BuildContainerOptions {
  env?: ReturnType<typeof loadEnv>;
  onProviderChange?: (event: ProviderChangeEvent) => void;
  /** Catalogo do ERP para o RAG dinamico (ex.: vendas em producao). */
  stockCatalog?: readonly StockItem[];
  /** Cliente Redis (ioredis/node-redis) para o RedisSessionStore; sem ele cai em memoria. */
  redisClient?: RedisLike;
  /** Cliente Prisma (PostgreSQL) para persistencia de conversas/mensagens. */
  prismaClient?: PrismaClient;
  /** Injeta um repositorio de mensagens para testes/demos. */
  repository?: IMessageRepository;
  /** Injeta providers falsos para testes/demos sem chamadas reais. */
  createProvider?: (config: import('./llm/types.js').LlmProviderConfig) => {
    chat(params: import('./llm/types.js').LlmChatParams): Promise<import('./llm/types.js').LlmResult>;
  };
}

export function buildContainer(options: BuildContainerOptions = {}): AppContainer {
  const env = options.env ?? loadEnv();

  const erp = new ErpClient({ baseURL: env.erp.baseURL, apiToken: env.erp.apiToken });
  const payment = new PaymentClient({
    baseURL: env.payment.baseURL,
    apiKey: env.payment.apiKey,
    webhookSecret: env.payment.webhookSecret || undefined,
  });
  const evolution = new EvolutionApi({
    baseURL: env.evolution.baseURL,
    instance: env.evolution.instance,
    apiKey: env.evolution.apiKey,
  });
  const crm = new CrmClient({
    baseURL: env.crm.baseURL,
    apiToken: env.crm.apiToken,
    enabled: env.crm.enabled,
  });
  const sessionStore = buildSessionStore(env, options.redisClient);
  const knowledgeBase = new KnowledgeBase();
  const metrics = new Metrics();
  const rateLimiter = new SlidingWindowRateLimiter(
    env.rateLimit.maxRequests,
    env.rateLimit.windowMs,
  );
  const sessionLock = new SessionLock();

  const repository =
    options.repository ??
    (env.databaseUrl ? new PrismaMessageRepository(options.prismaClient ?? defaultPrisma) : new InMemoryMessageRepository());

  const bling = new BlingClient({
    baseURL: env.bling.baseURL,
    accessToken: env.bling.accessToken,
  });
  const blingService = new BlingOrderService({ bling });

  if (options.stockCatalog && options.stockCatalog.length > 0) {
    knowledgeBase.ingest(KnowledgeBase.fromStockItems(options.stockCatalog));
  }

  const router = new LLMProviderRouter({
    primary: env.groq,
    fallback: env.gemini,
    ...(options.createProvider ? { createProvider: options.createProvider } : {}),
    onProviderChange: (e) => {
      metrics.recordProviderChange(e);
      options.onProviderChange?.(e);
    },
    onResult: (r) => metrics.recordLlmCall(r),
  });

  const cartSkill = new CartCalculatorSkill(
    { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
    defaultFreightCalculator,
  );
  const hardwareSkill = new HardwareCompatibilitySkill({
    resolver: new ProductSpecResolver({
      knowledgeBase,
      stockBySku: (s) => erp.stockBySku(s),
    }),
  });
  const getOrderStatus = async (orderId: string): Promise<OrderStatusInfo | null> => {
    const found = await sessionStore.findByOrderId?.(orderId);
    if (!found) return null;
    return {
      orderId,
      status: orderStatusForBotState(found.botState),
      totalCents: found.cart?.totalCents,
      paymentMethod: found.charge?.method,
      createdAt: found.updatedAt,
    };
  };
  const tools = new ToolRegistry({
    hardwareCompatibility: hardwareSkill,
    cartCalculator: cartSkill,
    getOrderStatus,
  });

  const handler = new MessageHandler({
    router,
    tools,
    sessionStore,
    knowledgeBase,
    rateLimiter,
    sessionLock,
    metrics,
    crmClient: crm,
    onTransition: createChargeOnTransition({
      payment,
      crmClient: crm,
      merchant: env.payment.pixMerchant.key ? { ...env.payment.pixMerchant } : undefined,
      expiresInMinutes: env.payment.pixExpiresInMinutes,
    }),
  });

  const paymentWebhook = new PaymentWebhookProcessor({
    paymentClient: payment,
    erpClient: erp,
    evolution: evolution,
    sessionStore,
    metrics,
    crmClient: crm,
  });

  const paymentExpiryJob = createPaymentExpiryJob({
    sessionStore,
    expire: (ticketId) => paymentWebhook.expire(ticketId),
  });

  const crmFollowUp = new CrmFollowUpHandler({ sessionStore, evolution });

  const evolutionWebhook = new EvolutionWebhookHandler({
    repository,
    messageHandler: handler,
    evolution,
    webhookSecret: env.evolution.webhookSecret || undefined,
  });

  const panelApi = new PanelApi({
    repository,
    evolution,
    bling: blingService,
    apiKey: env.agentApiKey,
  });

  return {
    router,
    handler,
    erp,
    payment,
    paymentWebhook,
    evolution,
    crm,
    crmFollowUp,
    sessionStore,
    knowledgeBase,
    metrics,
    paymentExpiryJob,
    repository,
    evolutionWebhook,
    panelApi,
  };
}

function orderStatusForBotState(state: BotStateId): string {
  switch (state) {
    case BotStateId.PAYMENT_CONFIRMED:
      return 'awaiting_nf';
    case BotStateId.PAYMENT_PENDING:
      return 'awaiting_payment';
    default:
      return 'processing';
  }
}

function buildSessionStore(
  env: ReturnType<typeof loadEnv>,
  redisClient?: RedisLike,
): ISessionStore {
  if (env.session.store === 'redis') {
    if (!redisClient) {
      console.warn('[session] SESSION_STORE=redis sem REDIS client injetado; usando memoria.');
      return new InMemorySessionStore({ ttlMs: env.session.ttlSeconds * 1000 });
    }
    return new RedisSessionStore({
      client: redisClient,
      ttlSeconds: env.session.ttlSeconds,
    });
  }
  return new InMemorySessionStore({ ttlMs: env.session.ttlSeconds * 1000 });
}
