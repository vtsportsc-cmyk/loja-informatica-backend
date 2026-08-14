import { z } from 'zod';

// Validacao das variaveis de ambiente.
// Groq (primario) e Google AI Studio / Gemini (fallback) sao obrigatorios;
// as demais usam defaults identicos aos do `.env.example`.
export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  // --- Provedor primario: Groq ---
  GROQ_API_KEY: z
    .string()
    .min(1, 'GROQ_API_KEY e obrigatoria. Gere uma chave em https://console.groq.com/keys'),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().min(1).default('llama-3.3-70b-versatile'),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(3500),

  // --- Provedor fallback: Google AI Studio (Gemini) ---
  GEMINI_API_KEY: z
    .string()
    .min(1, 'GEMINI_API_KEY e obrigatoria. Gere uma chave em https://aistudio.google.com/apikey'),
  GEMINI_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta/openai/'),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(3500),

  // --- ERP ---
  ERP_BASE_URL: z.string().url().default('https://erp.internal/v1'),
  ERP_API_TOKEN: z.string().default(''),

  // --- Evolution API (atendimento WhatsApp) ---
  EVOLUTION_BASE_URL: z.string().url().default('http://localhost:8080'),
  EVOLUTION_INSTANCE: z.string().default('loja'),
  EVOLUTION_API_KEY: z.string().default(''),
  // Segredo compartilhado para validar o header x-signature dos webhooks.
  EVOLUTION_WEBHOOK_SECRET: z.string().default(''),

  // --- Banco (PostgreSQL via Prisma) ---
  // Vazio = modo sem banco (InMemoryMessageRepository) para dev/demo.
  DATABASE_URL: z.string().default(''),

  // --- API do Painel CRM (apps/app -> apps/agent) ---
  AGENT_API_KEY: z.string().default('dev_agent_key'),
  // Numero do WhatsApp da loja (para links wa.me no Monte seu PC).
  STORE_WHATSAPP_NUMBER: z.string().default('5511999990000'),

  // --- Bling (NF / expedicao) ---
  BLING_BASE_URL: z.string().url().default('https://www.bling.com.br/Api/v3'),
  BLING_ACCESS_TOKEN: z.string().default(''),

  // --- Pagamentos ---
  PAYMENT_BASE_URL: z.string().url().default('https://gateway.payments/v1'),
  PAYMENT_API_KEY: z.string().default(''),
  // Segredo compartilhado para validar a assinatura HMAC (x-signature) dos
  // webhooks do gateway de pagamento. Vazio = aceita webhook sem assinatura.
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),
  PIX_MERCHANT_NAME: z.string().default('Loja de Informatica LTDA'),
  PIX_MERCHANT_CITY: z.string().default('SAO PAULO'),
  PIX_MERCHANT_KEY: z.string().default(''),
  PIX_EXPIRES_IN_MINUTES: z.coerce.number().int().positive().default(30),

  // --- Rate limit do atendimento ---
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // --- Sessao / persistencia ---
  SESSION_STORE: z.enum(['memory', 'redis']).default('memory'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // --- CRM (Backstage / gestao de oportunidades) ---
  CRM_API_URL: z.string().url().default('http://localhost:4000/api/v1'),
  CRM_API_TOKEN: z.string().default('crm_dev_token'),
  // true = envia eventos de ciclo de vida; false = no-op silencioso (dev).
  CRM_ENABLED: z
    .string()
    .default('false')
    .transform((v) => ['true', '1', 'yes'].includes(v.trim().toLowerCase())),

  // --- RAG ---
  RAG_INDEX_PATH: z.string().default('./data/knowledge-index.json'),
});

export type ValidEnv = z.infer<typeof envSchema>;
