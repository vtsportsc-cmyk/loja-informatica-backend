# Loja de Informática — Ecossistema LojaTech

Monorepo (npm workspaces) de uma loja de informática com:

- **`apps/app`** — Next.js (App Router + Tailwind): página **"Monte seu PC"** (builder com validação de compatibilidade e orçamento) e **Painel de CRM multi-atendente**.
- **`apps/agent`** — motor de atendimento serverless: WhatsApp via **Evolution API**, IA (Groq primário / Gemini fallback), FSM de vendas, PIX/cartão, eventos de CRM e emissão de NF via **Bling**.
- **`packages/db`** — Prisma/PostgreSQL compartilhado (clientes, conversas, mensagens, orçamentos, funil).
- **`packages/catalog`** — catálogo de hardware tipado + regras de compatibilidade e preços (PIX -5%, 12x com 1,99% a.m.).

Fluxo de alto nível:

```
Monte seu PC (apps/app) ── orçamento (Q-XXXXXX) ──► wa.me do WhatsApp da loja
Cliente conversa ──► Evolution API ──► POST /webhooks/whatsapp ──► MessageHandler (IA + FSM + RAG)
                                          │ mensagem com código Q- → funil "Oportunidade de Alto Valor"
                                          │   + vínculo do orçamento + aviso ao atendente (não-lido)
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
GET  /api/conversations          lista de conversas do funil (+ orçamento vinculado)
GET  /api/conversations/:id      conversa + histórico
POST /api/messages               vendedor envia mensagem { conversationId, agentId, text }
POST /api/conversations/:id/handoff   { action: "assume"|"release", agentId }
POST /api/conversations/:id/status    { status }  (AGUARDANDO_NF dispara o Bling)
```

Todas exigem o header `x-agent-key`.

#### Módulos do painel (`/crm`)

- **Funil de Vendas** — Kanban por estágio (`NOVO`, `MONTANDO_PC`, `EM_QUALIFICACAO`,
  `ALTA_VALOR`, `CARRINHO`, `PIX_GERADO`, `AGUARDANDO_NF`, `CONCLUIDO`), com valor do
  orçamento, não-lidos e indicador IA/humano por card.
- **Atendimento** — WhatsApp multi-atendente: lista de conversas, histórico, compositor e
  toggle **IA/Humano** (assumir/liberar) + painel de contexto com o resumo do pedido.
- **Pedidos** — tabela corporativa dos orçamentos vinculados (código, valores PIX/parcelado,
  situação Bling) com ação **Emitir pedido** (move o funil para `AGUARDANDO_NF` e dispara a
  emissão/expedição no Bling).

#### Oportunidade de Alto Valor

Quando o cliente envia pelo WhatsApp uma mensagem com um código de orçamento do
"Monte seu PC" (`Q-XXXXXX`), o agente automaticamente:

1. vincula o orçamento à conversa (`Quote.conversationId`);
2. promove o funil para **`ALTA_VALOR`** (se ainda em `NOVO`/`MONTANDO_PC`/`EM_QUALIFICACAO`);
3. incrementa o contador de não-lidos para chamar a atenção do atendente.

A IA segue respondendo normalmente (triagem/dúvidas); o lead fica sinalizado no painel
para atendimento manual. A rota `/builder` é 100% do cliente — sem elementos de CRM/chat —
e direciona a finalização para o WhatsApp da loja (`wa.me`).

## 5. Docker / produção

```bash
docker compose up --build -d
```

Sobe `db` (PostgreSQL), `redis`, `agent` (`apps/agent/Dockerfile`) e `web` (`apps/app/Dockerfile`).

Fluxo do vendedor (funil `AGUARDANDO_NF`): separar estoque físico → emitir NF (Bling) → dar baixa → mover o funil para `CONCLUIDO`.

## 6. Testes e qualidade

```bash
npm run typecheck   # todos os workspaces
npm test            # vitest (apps/agent) — 88 testes
npm run db:seed     # semente de agentes e conversa demo
```

## 7. n8n — Automação de Workflows (Meta Ads → CRM)

### Arquitetura

```
Meta Ads (Facebook/Instagram) ──► n8n webhook ──► Validação/spam filter
                                                        │
                                          ┌─────────────┼──────────────┐
                                          ▼             ▼              ▼
                                   POST /api/leads   POST /api/chat  Evolution API
                                   (NOVO_LEAD)       (Agente IA)    (WhatsApp)
                                   tag: MetaAds       contexto       delay 4s
```

### Infraestrutura Docker

O n8n é servido como container dentro do `docker-compose.yml`:

| Serviço | Porta | Descrição |
|---|---|---|
| n8n | **5678** | Interface + webhooks |
| agent | 3000 | Motor IA (interno ao n8n) |
| web | 3001 | Next.js (interno ao n8n) |
| db | 5432 | PostgreSQL compartilhado |
| redis | 6379 | Fila + sessão |

### Variáveis de ambiente (n8n no `.env` da VPS)

```bash
# n8n
N8N_PORT=5678
N8N_DB_PASSWORD=N8N_DB_PASSWORD_REMOVIDA
N8N_ENCRYPTION_KEY=N8N_ENCRYPTION_KEY_REMOVIDA
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=N8N_ADMIN_PASSWORD_REMOVIDA
PUBLIC_IP=PUBLIC_IP_REMOVIDO

# Meta Ads (preencher com token do Facebook)
FB_ACCESS_TOKEN=

# Integração interna
AGENT_API_KEY=AGENT_API_KEY_CHAVE_VAZADA_REMOVIDA
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=loja
```

### Acesso

**URL:** `http://PUBLIC_IP_REMOVIDO:5678`
**Login:** `admin` / `N8N_ADMIN_PASSWORD_REMOVIDA`

### Workflow: Meta Ads Leads → IA → WhatsApp CRM

Arquivo: `n8n/meta-ads-leads-workflow.json`
Importar via: n8n UI → Settings → Import from File.

**Pipeline:**

1. **Webhook** — escuta `POST /webhook/meta-ads-leads`
2. **Validar Payload** — filtra eventos Facebook (`object: "page"`, `field: "leadgen"`)
3. **Buscar Lead (FB Graph API)** — busca `full_name`, `phone_number`, `email`, `ad_name`, `campaign_name`
4. **Validar & Normalizar** — regex BR (11 dígitos, nonve 9), filtra spam/números de teste
5. **Inserir Lead** — `POST http://web:3000/api/leads` com status `NOVO_LEAD`, tag `MetaAds`
6. **Acionar Agente IA** — `POST http://agent:3000/api/chat` com contexto do anúncio
7. **Delay 4s** — anti-bloqueio WhatsApp
8. **Enviar WhatsApp** — via Evolution API (`sendText`)

### Setup na VPS

```bash
cd /root/loja-informatica
docker compose up -d n8n
```

O init script (`docker/init-n8n-db.sh`) cria o DB `n8n` automaticamente na primeira execução.
Se o PostgreSQL já existe, criar manualmente:

```bash
docker exec loja-informatica-db-1 psql -U loja -d loja -c "CREATE USER n8n WITH PASSWORD 'N8N_DB_PASSWORD_REMOVIDA';"
docker exec loja-informatica-db-1 psql -U loja -d loja -c "CREATE DATABASE n8n OWNER n8n;"
docker exec loja-informatica-db-1 psql -U loja -d loja -c "GRANT ALL PRIVILEGES ON DATABASE n8n TO n8n;"
```

### Próximos passos para ativar

1. Configurar **Facebook Lead Ads** webhook → `http://PUBLIC_IP_REMOVIDO:5678/webhook/meta-ads-leads`
2. Inserir `FB_ACCESS_TOKEN` no `.env` da VPS (token de Pages do Meta)
3. Verificar que a Evolution API tem a instância `loja` ativa
4. Importar o workflow JSON no n8n e ativá-lo
