# Loja de Informática — Ecossistema LojaTech

Monorepo (npm workspaces) de uma loja de informática com:

- **`apps/app`** — Next.js (App Router + Tailwind): página **"Monte seu PC"** (builder com validação de compatibilidade e orçamento) e **Painel de CRM multi-atendente**.
- **`apps/agent`** — motor de atendimento serverless: WhatsApp via **Evolution API**, IA (Groq primário / Gemini fallback), FSM de vendas, PIX/cartão, eventos de CRM e emissão de NF via **Bling**.
- **`packages/db`** — Prisma/PostgreSQL compartilhado (clientes, conversas, mensagens, orçamentos, funil).
- **`packages/catalog`** — catálogo de hardware tipado + regras de compatibilidade e preços (PIX -5%, 12x com 1,99% a.m.).

Fluxo de alto nível:

```
Monte seu PC (apps/app) ── orçamento ──► WhatsApp da loja
Cliente conversa ──► Evolution API ──► POST /webhooks/whatsapp ──► MessageHandler (IA + FSM + RAG)
                                          │ cria cobrança PIX / cartão
Pagamento ──► POST /webhooks/payment ──► PaymentWebhookProcessor (cria pedido "Aguardando NF")
Painel CRM (apps/app) ──► /api/conversations | handoff | status ──► AGUARDANDO_NF ──► Bling (NF)
Eventos de ciclo de vida ──► CRM externo (assíncrono) e follow-up no WhatsApp
```

## 1. Pré-requisitos

| Ferramenta | Versão | Onde usar |
|---|---|---|
| Node.js | >= 20 (testado na 22) | desenvolvimento |
| Docker + Docker Compose | recente | `docker compose up` |
| Conta Groq | grátis | provedor LLM primário |
| Conta Google AI Studio | grátis | provedor LLM fallback |
| Evolution API | v2 | instância do WhatsApp |
| PostgreSQL | 14+ | via Prisma (`packages/db`) |
| Bling | v3 (token) | emissão de NF/expedição |

## 2. Instalação

```bash
npm install
npm run db:generate      # gera o Prisma Client
npm run build            # compila packages + agent
npm test                 # roda os testes do agente
npm run typecheck        # typecheck de todos os workspaces
```

## 3. Variáveis de ambiente (`.env`)

```bash
cp .env.example .env
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não | Porta do agente (default `3000`) |
| **LLM** | | |
| `GROQ_API_KEY` | **sim** | Chave do Groq (https://console.groq.com/keys) |
| `GEMINI_API_KEY` | **sim** | Chave do Google AI Studio (https://aistudio.google.com/apikey) |
| **Evolution API** | | |
| `EVOLUTION_BASE_URL` | não | URL da instância (default `http://localhost:8080`) |
| `EVOLUTION_INSTANCE` | não | Nome da instância (default `loja`) |
| `EVOLUTION_API_KEY` | não | Chave da API (`apikey`) |
| `EVOLUTION_WEBHOOK_SECRET` | não | Valida o `x-signature` dos webhooks |
| **Banco** | | |
| `DATABASE_URL` | prod | PostgreSQL (vazio = repositório em memória para dev/demo) |
| **Painel CRM** | | |
| `AGENT_API_KEY` | não | Header `x-agent-key` das rotas `/api/*` do agente |
| `STORE_WHATSAPP_NUMBER` | não | Número da loja nos links `wa.me` |
| **Bling** | | |
| `BLING_ACCESS_TOKEN` | não | Token v3 (vazio = no-op; NF não é emitida) |
| **Pagamentos** | | |
| `PAYMENT_BASE_URL` / `PAYMENT_API_KEY` / `PAYMENT_WEBHOOK_SECRET` | prod | Gateway PIX/cartão |
| `PIX_MERCHANT_KEY` | prod | Chave PIX do vendedor |
| **Sessão / CRM / RAG** | | `SESSION_STORE`, `REDIS_URL`, `CRM_API_URL`, `CRM_ENABLED`, `RAG_INDEX_PATH` |

### apps/app

O painel CRM usa um proxy (`/api/crm/*`) para o agente com:

```env
AGENT_API_URL=http://localhost:3000
AGENT_API_KEY=dev_agent_key
STORE_WHATSAPP_NUMBER=5511999990000
```

**Segurança do painel**: `/crm` e `/api/crm/*` são protegidos por HTTP Basic Auth
(middleware Next.js). Em produção defina `CRM_PANEL_USERNAME` e `CRM_PANEL_PASSWORD`
(senha forte). A troca exige rebuild do app (`npm run build -w @loja/app`).

## 4. Rodando em desenvolvimento

```bash
npm run dev:agent     # agente em :3000 (tsx)
npm run dev:app       # app em :3001 (next dev)
```

Cadastre na Evolution API o webhook de **mensagens** apontando para:

```
POST http://localhost:3000/webhooks/whatsapp   (evento: messages.upsert)
```

### Painel CRM

```
GET  /api/conversations          lista de conversas do funil
GET  /api/conversations/:id      conversa + histórico
POST /api/messages               vendedor envia mensagem { conversationId, agentId, text }
POST /api/conversations/:id/handoff   { action: "assume"|"release", agentId }
POST /api/conversations/:id/status    { status }  (AGUARDANDO_NF dispara o Bling)
```

Todas exigem o header `x-agent-key`.

## 5. Docker / produção

```bash
docker compose up --build -d
```

Sobe `db` (PostgreSQL), `redis`, `agent` (`apps/agent/Dockerfile`) e `web` (`apps/app/Dockerfile`).

Fluxo do vendedor (funil `AGUARDANDO_NF`): separar estoque físico → emitir NF (Bling) → dar baixa → mover o funil para `CONCLUIDO`.

## 6. Testes e qualidade

```bash
npm run typecheck   # todos os workspaces
npm test            # vitest (apps/agent) — 81 testes
npm run db:seed     # semente de agentes e conversa demo
```
