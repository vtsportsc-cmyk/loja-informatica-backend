import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envSchema } from './env.schema.js';

// Carrega o arquivo .env (quando existir) para process.env SEM sobrescrever
// variaveis ja definidas pelo ambiente/CI. Usado no boot e no check:env.
export function loadDotEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    const key = m?.[1];
    const value = m?.[2];
    if (key && value !== undefined && process.env[key] === undefined) {
      process.env[key] = value.replace(/^"|"$/g, '');
    }
  }
}

export interface EnvConfig {
  port: number;
  groq: { name: string; apiKey: string; baseURL: string; model: string; timeoutMs: number };
  gemini: { name: string; apiKey: string; baseURL: string; model: string; timeoutMs: number };
  erp: { baseURL: string; apiToken: string };
  evolution: { baseURL: string; instance: string; apiKey: string; webhookSecret: string };
  databaseUrl: string;
  agentApiKey: string;
  storeWhatsappNumber: string;
  bling: { baseURL: string; accessToken: string };
  payment: { baseURL: string; apiKey: string; webhookSecret: string; pixMerchant: { name: string; city: string; key: string }; pixExpiresInMinutes: number };
  rateLimit: { maxRequests: number; windowMs: number };
  session: { store: 'memory' | 'redis'; ttlSeconds: number; redisUrl: string };
  crm: { baseURL: string; apiToken: string; enabled: boolean };
  ragIndexPath: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Variaveis de ambiente invalidas: ${detail}`);
  }
  const v = parsed.data;
  return {
    port: v.PORT,
    groq: {
      name: 'groq',
      apiKey: v.GROQ_API_KEY,
      baseURL: v.GROQ_BASE_URL,
      model: v.GROQ_MODEL,
      timeoutMs: v.GROQ_TIMEOUT_MS,
    },
    gemini: {
      name: 'gemini',
      apiKey: v.GEMINI_API_KEY,
      baseURL: v.GEMINI_BASE_URL,
      model: v.GEMINI_MODEL,
      timeoutMs: v.GEMINI_TIMEOUT_MS,
    },
    erp: {
      baseURL: v.ERP_BASE_URL,
      apiToken: v.ERP_API_TOKEN,
    },
    evolution: {
      baseURL: v.EVOLUTION_BASE_URL,
      instance: v.EVOLUTION_INSTANCE,
      apiKey: v.EVOLUTION_API_KEY,
      webhookSecret: v.EVOLUTION_WEBHOOK_SECRET,
    },
    databaseUrl: v.DATABASE_URL,
    agentApiKey: v.AGENT_API_KEY,
    storeWhatsappNumber: v.STORE_WHATSAPP_NUMBER,
    bling: {
      baseURL: v.BLING_BASE_URL,
      accessToken: v.BLING_ACCESS_TOKEN,
    },
    payment: {
      baseURL: v.PAYMENT_BASE_URL,
      apiKey: v.PAYMENT_API_KEY,
      webhookSecret: v.PAYMENT_WEBHOOK_SECRET,
      pixMerchant: {
        name: v.PIX_MERCHANT_NAME,
        city: v.PIX_MERCHANT_CITY,
        key: v.PIX_MERCHANT_KEY,
      },
      pixExpiresInMinutes: v.PIX_EXPIRES_IN_MINUTES,
    },
    rateLimit: {
      maxRequests: v.RATE_LIMIT_MAX_REQUESTS,
      windowMs: v.RATE_LIMIT_WINDOW_MS,
    },
    session: {
      store: v.SESSION_STORE,
      ttlSeconds: v.SESSION_TTL_SECONDS,
      redisUrl: v.REDIS_URL,
    },
    crm: {
      baseURL: v.CRM_API_URL,
      apiToken: v.CRM_API_TOKEN,
      enabled: v.CRM_ENABLED,
    },
    ragIndexPath: v.RAG_INDEX_PATH,
  };
}
