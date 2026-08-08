import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';
import type { AppContainer } from './container.js';
import { RedisSessionStore } from './agent/RedisSessionStore.js';
import { suriInboundSchema } from './types/index.js';

// Entry HTTP enxuto (sem dependencias de framework) para ambiente serverless.
// Rotas:
//   GET  /health
//   GET  /metrics            -> Prometheus text (observabilidade)
//   POST /webhooks/suri     -> mensagem do cliente no SURI
//   POST /webhooks/payment  -> notificacao de pagamento (PIX / cartao)
//   POST /webhooks/crm/follow-up -> reengajamento disparado pelo CRM
export function createAppServer(
  port = loadEnv().port,
  container: AppContainer = buildContainer(),
): Server {
  container.paymentExpiryJob.start();

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
    });
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    res.end(container.metrics.toPrometheus());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/suri') {
    try {
      const raw = await readBody(req);
      const inbound = suriInboundSchema.parse(JSON.parse(raw));
      const response = await container.handler.processInbound(inbound);
      return json(res, 200, response);
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

  return json(res, 404, { error: 'rota nao encontrada' });
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
