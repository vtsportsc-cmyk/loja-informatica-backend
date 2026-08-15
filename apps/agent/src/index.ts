import type { Server } from 'node:http';
import { Redis } from 'ioredis';
import { RedisSessionStore } from './agent/RedisSessionStore.js';
import { RedisInstitutionalCache } from './rag/institutionalCache.js';
import type { RedisLike } from './agent/RedisSessionStore.js';
import { loadDotEnvFile, loadEnv } from './config/env.js';
import type { EnvConfig } from './config/env.js';
import { buildContainer } from './container.js';
import type { AppContainer } from './container.js';
import { createAppServer } from './server.js';

// ============================================================================
// Entry de producao (cloud/Docker).
// Ordem de inicializacao:
//   1. loadEnv()  -> validacao Zod de TODAS as variaveis antes de subir;
//   2. conecta no Redis quando SESSION_STORE=redis (ping de saude com timeout);
//   3. buildContainer() injeta o cliente Redis no RedisSessionStore;
//   4. createAppServer() sobe o HTTP (health, metrics, webhooks WhatsApp/pagamento);
//   5. shutdown gracioso em SIGTERM/SIGINT: para o job de expiracao PIX,
//      fecha o servidor e desconecta do Redis.
// ============================================================================

const SHUTDOWN_TIMEOUT_MS = 5_000;

export async function bootstrap(
  env: EnvConfig = loadEnv(),
): Promise<{ server: Server; container: AppContainer }> {
  const needsSessionRedis = env.session.store === 'redis';
  const needsCacheRedis = env.cache.enabled;

  // 1. Redis das sessoes: obrigatorio quando SESSION_STORE=redis (falha no boot).
  // 2. Redis do cache institucional: opcional; se nao responder, degrada para
  //    memoria (o agente continua funcionando, so perde o cache compartilhado).
  let redisClient: (RedisLike & { quit(): Promise<void> }) | undefined;
  if (needsSessionRedis) {
    redisClient = await connectRedis(env.session.redisUrl);
  } else if (needsCacheRedis) {
    redisClient = await connectCacheRedis(env.cache.redisUrl);
  }

  const container = buildContainer({
    env,
    redisClient,
    onProviderChange: (e) => {
      console.log(`[router] fallback: ${e.from} -> ${e.to} (${e.reason})`);
    },
  });

  logBootSummary(env, container);

  const server = createAppServer(env.port, container);
  registerShutdownHandlers(server, container, redisClient);
  return { server, container };
}

export async function connectRedis(url: string): Promise<RedisLike & { quit(): Promise<void> }> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 500, 3_000),
  });

  // ioredis reconecta sozinho; sem esse listener um 'error' de conexao em runtime
  // seria tratado como unhandled e derrubaria o processo.
  client.on('error', (err: Error) => {
    console.warn(`[redis] conexao: ${err.message}`);
  });

  try {
    // Pre-check: garante que o Redis esta alcancavel antes de expor o servidor.
    await pingRedis(client, url);
  } catch (err) {
    await client.quit().catch(() => undefined);
    throw new Error(
      `[boot] SESSION_STORE=redis mas o Redis em ${url} nao respondeu ao ping. ` +
        `Cheque o container/servico Redis e o REDIS_URL. (${(err as Error).message})`,
    );
  }

  return wrapRedisClient(client);
}

/** Conexao do cache institucional: falha SOFT (nunca derruba o boot). */
async function connectCacheRedis(
  url: string,
): Promise<(RedisLike & { quit(): Promise<void> }) | undefined> {
  try {
    const client = await connectRedis(url);
    console.log(`[boot] cache.institutional=redis (${sanitizeUrl(url)})`);
    return client;
  } catch (err) {
    console.warn(
      `[boot] cache.institutional=memory (fallback): Redis indisponivel em ${url}. ${(err as Error).message}`,
    );
    return undefined;
  }
}

function wrapRedisClient(
  client: Redis,
): RedisLike & { ping(): Promise<string>; quit(): Promise<void> } {
  return {
    get: (key) => client.get(key),
    set: (key, value, opts) =>
      opts?.ex ? client.set(key, value, 'EX', opts.ex) : client.set(key, value),
    del: (key) => client.del(key),
    keys: (pattern) => client.keys(pattern),
    ping: () => client.ping(),
    quit: () => client.quit().then(() => undefined),
  };
}

function pingRedis(client: Redis, url: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout apos ${timeoutMs}ms`));
    }, timeoutMs);
    client
      .ping()
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      });
  });
}

function logBootSummary(env: EnvConfig, container: AppContainer): void {
  console.log('[boot] loja-informatica-backend');
  console.log(`[boot] port=${env.port}`);
  console.log(`[boot] llm.primary=${env.groq.name}/${env.groq.model}${env.groq.apiKey ? '' : ' (SEM CHAVE)'}`);
  console.log(`[boot] llm.fallback=${env.gemini.name}/${env.gemini.model}${env.gemini.apiKey ? '' : ' (SEM CHAVE)'}`);
  console.log(
    `[boot] transcription.enabled=${env.transcription.enabled ? 'sim' : 'nao'} ` +
      `groq=${env.transcription.groqModel} gemini=${env.transcription.geminiModel}`,
  );
  console.log(`[boot] session.store=${env.session.store} ttl=${env.session.ttlSeconds}s`);
  console.log(`[boot] erp=${env.erp.baseURL}`);
  console.log(`[boot] evolution=${env.evolution.baseURL} instance=${env.evolution.instance}`);
  console.log(`[boot] database=${sanitizeDatabaseUrl(env.databaseUrl)}`);
  console.log(`[boot] bling=${env.bling.baseURL} enabled=${env.bling.accessToken ? 'sim' : 'nao (no-op)'}`);
  console.log(`[boot] payment=${env.payment.baseURL}`);
  console.log(`[boot] crm=${env.crm.baseURL} enabled=${env.crm.enabled ? 'sim' : 'nao (no-op)'}`);
  console.log(
    `[boot] followup.inactivityHours=${env.followUp.inactivityHours} intervalMinutes=${Math.round(env.followUp.intervalMs / 60_000)}`,
  );
  if (env.session.store === 'redis') {
    console.log(`[boot] redis.url=${sanitizeUrl(env.session.redisUrl)}`);
  }
  if (container.sessionStore instanceof RedisSessionStore) {
    console.log('[boot] session.store.redis=conectado');
  }
  const cacheType =
    container.institutionalCache instanceof RedisInstitutionalCache ? 'redis' : 'memory';
  console.log(
    `[boot] cache.institutional=${cacheType} enabled=${env.cache.enabled ? 'sim' : 'nao'} ttl=${env.cache.ttlSeconds}s`,
  );
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return url;
  }
}

function sanitizeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return url;
  }
}

function registerShutdownHandlers(
  server: Server,
  container: AppContainer,
  redisClient?: RedisLike & { quit(): Promise<void> },
): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[boot] ${signal} recebido, encerrando...`);

    container.paymentExpiryJob.stop();
    container.quoteFollowUpJob?.stop();

    server.close(() => {
      void (redisClient ? redisClient.quit() : Promise.resolve()).finally(() => {
        console.log('[boot] encerrado.');
        process.exit(0);
      });
    });

    // Forca saida se algo travar na conexao em andamento.
    setTimeout(() => {
      console.error('[boot] timeout no shutdown, forcando saida.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

// Execucao principal (quando chamado diretamente: node dist/index.js).
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  loadDotEnvFile();
  bootstrap().catch((err: unknown) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
