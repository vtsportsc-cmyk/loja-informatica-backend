import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envSchema } from './env.schema.js';

// Carrega o arquivo .env (quando existir) para process.env SEM sobrescrever
// variaveis ja definidas pelo ambiente/CI. Procura no diretorio atual e sobe
// a arvore de pastas ate a raiz, cobrindo o monorepo (workspace vs raiz).
export function loadDotEnvFile(startDir = process.cwd()): void {
  let dir = resolve(startDir);
  const visited = new Set<string>();
  while (!visited.has(dir)) {
    visited.add(dir);
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      const lines = readFileSync(candidate, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        const key = m?.[1];
        const value = m?.[2];
        if (key && value !== undefined && process.env[key] === undefined) {
          process.env[key] = value.replace(/^"|"$/g, '');
        }
      }
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return;
    dir = parent;
  }
}

export interface EnvConfig {
  port: number;
  groq: { name: string; apiKey: string; baseURL: string; model: string; timeoutMs: number };
  gemini: { name: string; apiKey: string; baseURL: string; model: string; timeoutMs: number };
  transcription: {
    enabled: boolean;
    groqModel: string;
    geminiModel: string;
    geminiBaseURL: string;
  };
  erp: { baseURL: string; apiToken: string };
  evolution: { baseURL: string; instance: string; apiKey: string; webhookSecret: string };
  instagram: {
    enabled: boolean;
    instance: string;
    webhookSecret: string;
    verifyToken: string;
    appUrl: string;
  };
  databaseUrl: string;
  agentApiKey: string;
  storeWhatsappNumber: string;
  bling: { baseURL: string; accessToken: string };
  payment: { baseURL: string; apiKey: string; webhookSecret: string; pixMerchant: { name: string; city: string; key: string }; pixExpiresInMinutes: number };
  rateLimit: { maxRequests: number; windowMs: number };
  session: { store: 'memory' | 'redis'; ttlSeconds: number; redisUrl: string };
  cache: { enabled: boolean; redisUrl: string; ttlSeconds: number };
  crm: { baseURL: string; apiToken: string; enabled: boolean };
  ragIndexPath: string;
  followUp: { inactivityHours: number; intervalMs: number };
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
    transcription: {
      enabled: v.AUDIO_TRANSCRIPTION_ENABLED,
      groqModel: v.GROQ_TRANSCRIPTION_MODEL,
      geminiModel: v.GEMINI_AUDIO_MODEL,
      geminiBaseURL: v.GEMINI_AUDIO_BASE_URL,
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
    instagram: {
      enabled: v.INSTAGRAM_AUTOMATION_ENABLED,
      instance: v.EVOLUTION_INSTAGRAM_INSTANCE,
      webhookSecret: v.INSTAGRAM_WEBHOOK_SECRET,
      verifyToken: v.INSTAGRAM_WEBHOOK_TOKEN,
      appUrl: v.APP_PUBLIC_URL,
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
    cache: {
      enabled: v.REDIS_CACHE_ENABLED,
      redisUrl: v.REDIS_CACHE_URL || v.REDIS_URL,
      ttlSeconds: v.INSTITUTIONAL_CACHE_TTL_SECONDS,
    },
    crm: {
      baseURL: v.CRM_API_URL,
      apiToken: v.CRM_API_TOKEN,
      enabled: v.CRM_ENABLED,
    },
    ragIndexPath: v.RAG_INDEX_PATH,
    followUp: {
      inactivityHours: v.FOLLOWUP_INACTIVITY_HOURS,
      intervalMs: v.FOLLOWUP_INTERVAL_MINUTES * 60_000,
    },
  };
}
