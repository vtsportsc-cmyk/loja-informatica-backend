import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';
import type { AppContainer } from './container.js';
import { RedisSessionStore } from './agent/RedisSessionStore.js';
import { collectSystemStatus } from './routes/health.js';

// Entry HTTP enxuto (sem dependencias de framework) para ambiente serverless.
// Rotas:
//   GET  /health                       -> saude do servico
//   GET  /metrics                      -> Prometheus text (observabilidade)
//   POST /webhooks/whatsapp            -> mensagem do cliente via Evolution API
//   GET  /webhooks/instagram           -> validacao do webhook (hub.challenge)
//   POST /webhooks/instagram           -> comentario/Direct do Instagram (lead)
//   POST /webhooks/payment             -> notificacao de pagamento (PIX / cartao)
//   POST /webhooks/crm/follow-up       -> reengajamento disparado pelo CRM
//   POST /api/messages                 -> vendedor envia msg (painel CRM)
//   GET  /api/agents                   -> lista de atendentes (painel CRM)
//   GET  /api/system/status            -> saude do sistema (telemetria painel)
//   GET  /api/conversations            -> lista de conversas do funil (painel)
//   GET  /api/conversations/:id        -> conversa + historico de mensagens
//   POST /api/conversations/:id/handoff-> assumir/liberar atendimento (painel)
//   POST /api/conversations/:id/status -> mover funil (painel; dispara Bling)
//   POST /api/conversations/:id/department -> atribuir departamento/atendente
//   POST /api/conversations/:id/source  -> definir origem do lead (painel)
//   POST /api/conversations/:id/lost    -> marcar como perdido (painel)
//   POST /api/conversations/:id/notes   -> registrar anotacao interna (painel)
export function createAppServer(
  port = loadEnv().port,
  container: AppContainer = buildContainer(),
): Server {
  container.paymentExpiryJob.start();
  container.quoteFollowUpJob?.start();

  return createServer((req, res) => {
    void handle(req, res, container);
  }).listen(port, () => {
    console.log(`[serverless] listening on :${port}`);
  });
}

async function handle(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  container: AppContainer,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    const sessions = (await container.sessionStore.all?.()) ?? [];
    return json(res, 200, {
      ok: true,
      provider: container.router.activeProvider,
      circuitOpen: container.router.state.circuitOpen,
      sessionStore: {
        type: container.sessionStore instanceof RedisSessionStore ? 'redis' : 'memory',
        size: sessions.length,
        fallbackActive: container.router.state.fallbackActive,
      },
      institutionalAnswers: container.answerService.stats(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    res.end(container.metrics.toPrometheus());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/whatsapp') {
    if (!container.evolutionWebhook) {
      return json(res, 501, { error: 'webhook nao configurado' });
    }
    try {
      const raw = await readBody(req);
      const signature = req.headers['x-signature'] as string | undefined;
      const result = await container.evolutionWebhook.handle(raw, signature);
      if (!result.ok) {
        return json(res, 400, { error: result.error ?? 'falha ao processar' });
      }
      return json(res, 200, { ok: true, handled: result.handled ?? false });
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  }

  // Verificacao do webhook do Meta Graph API (hub.challenge) SEMPRE responde,
  // mesmo com a automacao desabilitada, para permitir a assinatura do app.
  if (req.method === 'GET' && url.pathname === '/webhooks/instagram') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === container.instagramVerifyToken && challenge) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(challenge);
      return;
    }
    return json(res, 403, { error: 'verificacao do webhook falhou' });
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/instagram') {
    if (!container.instagramWebhook) {
      return json(res, 501, { error: 'webhook instagram nao configurado' });
    }
    try {
      const raw = await readBody(req);
      const signature = (req.headers['x-hub-signature-256'] as string | undefined) ??
        (req.headers['x-signature'] as string | undefined);
      const result = await container.instagramWebhook.handle(raw, signature);
      if (!result.ok) {
        return json(res, 400, { error: result.error ?? 'falha ao processar' });
      }
      return json(res, 200, { ok: true, handled: result.handled ?? false });
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/payment') {
    try {
      const raw = await readBody(req);
      const signature = req.headers['x-signature'] as string | undefined;
      const result = await container.paymentWebhook.process(raw, signature);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/crm/follow-up') {
    if (!container.crmFollowUp) {
      return json(res, 404, { error: 'rota nao encontrada' });
    }
    try {
      const raw = await readBody(req);
      const result = await container.crmFollowUp.handle(raw);
      if (!result.ok && result.reason === 'session_not_found') {
        return json(res, 404, result);
      }
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/messages') {
    return panelRequest(req, res, container, async (panel, body) => panel.sendMessage(body));
  }

  if (req.method === 'GET' && url.pathname === '/api/agents') {
    if (!container.panelApi) {
      return json(res, 501, { error: 'api do painel nao configurada' });
    }
    if (!container.panelApi.checkAuth(req.headers['x-agent-key'] as string | undefined)) {
      return json(res, 401, { error: 'chave de API invalida' });
    }
    const result = await container.panelApi.listAgents();
    return json(res, result.status ?? 400, result.ok ? result.data ?? {} : { error: result.error });
  }

  if (req.method === 'GET' && url.pathname === '/api/conversations') {
    if (!container.panelApi) {
      return json(res, 501, { error: 'api do painel nao configurada' });
    }
    if (!container.panelApi.checkAuth(req.headers['x-agent-key'] as string | undefined)) {
      return json(res, 401, { error: 'chave de API invalida' });
    }
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const result = await container.panelApi.listConversations({ cursor, limit });
    return json(res, result.status ?? 400, result.ok ? result.data ?? {} : { error: result.error });
  }

  const conversationGet = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (req.method === 'GET' && conversationGet) {
    const id = conversationGet[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    if (!container.panelApi) {
      return json(res, 501, { error: 'api do painel nao configurada' });
    }
    if (!container.panelApi.checkAuth(req.headers['x-agent-key'] as string | undefined)) {
      return json(res, 401, { error: 'chave de API invalida' });
    }
    const result = await container.panelApi.getConversation(id);
    return json(res, result.status ?? 400, result.ok ? result.data ?? {} : { error: result.error });
  }

  const handoffMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/handoff$/);
  if (req.method === 'POST' && handoffMatch) {
    const id = handoffMatch[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    return panelRequest(req, res, container, async (panel, body) => panel.handoff(id, body));
  }

  const statusMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/status$/);
  if (req.method === 'POST' && statusMatch) {
    const id = statusMatch[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    return panelRequest(req, res, container, async (panel, body) => panel.setStatus(id, body));
  }

  const departmentMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/department$/);
  if (req.method === 'POST' && departmentMatch) {
    const id = departmentMatch[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    return panelRequest(req, res, container, async (panel, body) => panel.assignDepartment(id, body));
  }

  const sourceMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/source$/);
  if (req.method === 'POST' && sourceMatch) {
    const id = sourceMatch[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    return panelRequest(req, res, container, async (panel, body) => panel.setLeadSource(id, body));
  }

  const lostMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/lost$/);
  if (req.method === 'POST' && lostMatch) {
    const id = lostMatch[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    return panelRequest(req, res, container, async (panel, body) => panel.markLost(id, body));
  }

  const notesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/notes$/);
  if (req.method === 'POST' && notesMatch) {
    const id = notesMatch[1];
    if (!id) return json(res, 400, { error: 'id ausente' });
    return panelRequest(req, res, container, async (panel, body) => panel.addNote(id, body));
  }

  if (req.method === 'GET' && url.pathname === '/api/system/status') {
    if (!container.panelApi) {
      return json(res, 501, { error: 'api do painel nao configurada' });
    }
    if (!container.panelApi.checkAuth(req.headers['x-agent-key'] as string | undefined)) {
      return json(res, 401, { error: 'chave de API invalida' });
    }
    const status = await collectSystemStatus({
      evolution: container.evolution,
      metrics: container.metrics,
      repository: container.repository,
      redis: container.redis,
      provider: container.router.state,
    });
    return json(res, 200, { ok: true, status });
  }

  return json(res, 404, { error: 'rota nao encontrada' });
}

async function panelRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  container: AppContainer,
  run: (panel: NonNullable<AppContainer['panelApi']>, body: unknown) => Promise<{
    ok: boolean;
    status?: number;
    data?: unknown;
    error?: string;
  }>,
): Promise<void> {
  if (!container.panelApi) {
    return json(res, 501, { error: 'api do painel nao configurada' });
  }
  if (!container.panelApi.checkAuth(req.headers['x-agent-key'] as string | undefined)) {
    return json(res, 401, { error: 'chave de API invalida' });
  }
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const result = await run(container.panelApi, body);
    return json(res, result.status ?? 400, result.ok ? result.data ?? {} : { error: result.error });
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  createAppServer();
}
