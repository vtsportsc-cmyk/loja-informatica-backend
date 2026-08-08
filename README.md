# Loja de Informatica — Backend (WhatsApp/SURI + PIX + Cartão)

Backend serverless + motor de automação de vendas para loja física de informática.
O cliente conversa pelo WhatsApp (via plataforma **SURI**), monta um PC/compra com a
ajuda de uma IA (Groq primário, Gemini fallback), escolhe frete por CEP, reserva o
estoque, paga por **PIX** (ou cartão) e um vendedor humano confere o pedido e emite a
**Nota Fiscal**.

Fluxo de alto nível:

```
WhatsApp → SURI → POST /webhooks/suri → MessageHandler (IA + FSM + RAG + Ferramentas)
                                              │ cria cobrança PIX / cartão
Pagamento → Gateway → POST /webhooks/payment → PaymentWebhookProcessor
                                              │ confirma pagamento, cria pedido
                                              │ "Aguardando NF" no ERP e avisa o vendedor
Eventos de ciclo de vida → CRM (trycompai/crm)  (assíncrono, nunca bloqueia)
CRM → POST /webhooks/crm/follow-up → reengajamento de vendas no WhatsApp
```

---

## 1. Pré-requisitos

| Ferramenta | Versão | Onde usar |
|---|---|---|
| Node.js | >= 20 (testado na 22) | desenvolvimento e `npm start` |
| Docker + Docker Compose | recente | produção / `docker compose up` |
| Conta Groq | grátis | provedor LLM primário |
| Conta Google AI Studio | grátis | provedor LLM fallback |
| Plataforma SURI | — | atendimento WhatsApp |
| Gateway de pagamento | — | cobranças PIX/cartão + webhooks |
| ERP | — | estoque, travas e pedidos |

---

## 2. Variáveis de ambiente (`.env`)

Copie o modelo e preencha as chaves:

```bash
cp .env.example .env
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não | Porta do servidor (default `3000`) |
| **LLM** | | |
| `GROQ_API_KEY` | **sim** | Chave do Groq (https://console.groq.com/keys) |
| `GROQ_BASE_URL` | não | Default `https://api.groq.com/openai/v1` |
| `GROQ_MODEL` | não | Default `llama-3.3-70b-versatile` |
| `GROQ_TIMEOUT_MS` | não | Timeout das chamadas (default `3500`) |
| `GEMINI_API_KEY` | **sim** | Chave do Google AI Studio (https://aistudio.google.com/apikey) |
| `GEMINI_BASE_URL` | não | Default `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `GEMINI_MODEL` | não | Default `gemini-3.5-flash` |
| `GEMINI_TIMEOUT_MS` | não | Timeout das chamadas (default `3500`) |
| **ERP** | | |
| `ERP_BASE_URL` | não | URL da API do ERP (default `https://erp.internal/v1`) |
| `ERP_API_TOKEN` | não | Token Bearer do ERP |
| **SURI (WhatsApp)** | | |
| `SURI_BASE_URL` | não | URL da API do SURI (default `https://api.suri.pt/v1`) |
| `SURI_WEBHOOK_TOKEN` | não | Token Bearer usado ao responder/atualizar tickets no SURI |
| **Pagamentos** | | |
| `PAYMENT_BASE_URL` | não | URL da API do gateway (default `https://gateway.payments/v1`) |
| `PAYMENT_API_KEY` | não | Chave da API do gateway |
| `PAYMENT_WEBHOOK_SECRET` | não | Segredo p/ validar assinatura HMAC `x-signature` do webhook |
| `PIX_MERCHANT_NAME` | não | Nome do recebedor no QR Code PIX |
| `PIX_MERCHANT_CITY` | não | Cidade do recebedor no QR Code PIX |
| `PIX_MERCHANT_KEY` | não | Chave PIX (CPF/CNPJ/e-mail/telefone) do recebedor |
| `PIX_EXPIRES_IN_MINUTES` | não | Validade da cobrança PIX (default `30`) |
| **Rate limit** | | |
| `RATE_LIMIT_MAX_REQUESTS` | não | Máx. mensagens/ticket na janela (default `20`) |
| `RATE_LIMIT_WINDOW_MS` | não | Janela em ms (default `60000`) |
| **Sessão / persistência** | | |
| `SESSION_STORE` | não | `memory` (padrão) ou `redis` para sessão distribuída |
| `SESSION_TTL_SECONDS` | não | TTL de inatividade da sessão (default `1800` = 30 min) |
| `REDIS_URL` | não | URL do Redis (default `redis://localhost:6379`) |
| **RAG** | | |
| `RAG_INDEX_PATH` | não | Caminho do índice de conhecimento (default `./data/knowledge-index.json`) |
| **CRM (Backstage / Gestão de Oportunidades)** | | |
| `CRM_API_URL` | não | URL da API do CRM (default `http://localhost:4000/api/v1`) |
| `CRM_API_TOKEN` | não | Token Bearer do CRM (default dev `crm_dev_token`) |
| `CRM_ENABLED` | não | `true` envia eventos de ciclo de vida; `false` = no-op silencioso (default `false`) |

> **Segurança:** nunca commite o `.env` (já está no `.gitignore`). Em produção,
> use o cofre de segredos da sua nuvem ou as envs do container/compose.

---

## 3. Rodando localmente (desenvolvimento)

```bash
npm ci
cp .env.example .env      # preencha GROQ_API_KEY e GEMINI_API_KEY
npm run dev               # tsx watch? (tsx direto) sobe em http://localhost:3000
```

Validação rápida do ambiente (mesmo schema Zod do runtime):

```bash
npm run check:env
```

---

## 4. Rodando em produção

### 4.1 Direto com Node (servidor/VPS)

```bash
npm ci
cp .env.example .env      # preencha todas as chaves
SESSION_STORE=redis       # se tiver Redis; senão use memory
npm start                 # prestart: build + check:env; start: node dist/index.js
```

O `prestart` executa, em ordem:
1. `npm run build` (compila para `dist/`);
2. `npm run check:env` (validação Zod de todas as variáveis — falha antes de subir);
3. `node dist/index.js` sobe o servidor, que **valida o ambiente novamente no boot**,
   conecta no Redis (quando `SESSION_STORE=redis`) e começa a aceitar requisições.

Desligamento gracioso em `SIGTERM`/`SIGINT`: para o job de expiração de PIX, fecha o
servidor e desconecta do Redis.

### 4.2 Docker Compose (recomendado — 100% cloud)

A stack sobe **aplicação + Redis** (sessão distribuída):

```bash
cp .env.example .env            # preencha as chaves
docker compose up --build -d    # app + redis
docker compose logs -f app      # acompanhar logs
docker compose down             # derrubar
```

O compose:
- injeta o `.env` na aplicação;
- força `SESSION_STORE=redis` e `REDIS_URL=redis://redis:6379` (aponta para o container `redis`);
- publica `PORT` (default `3000`) na máquina host;
- espera o Redis ficar saudável (`service_healthy`) antes de subir a app;
- persiste o Redis em um volume (`redis-data`) com `appendonly yes`.

### 4.3 Dockerfile (imagem pronta)

Build multi-stage em `node:22-alpine`:
- **deps** → `npm ci`;
- **build** → `tsc` + `npm prune --omit=dev` (imagem final sem tooling de build);
- **runtime** → usuário não-root (`node`), `NODE_ENV=production`, `HEALTHCHECK` em `/health`,
  `EXPOSE 3000`, `CMD node dist/index.js`.

---

## 5. Endpoints HTTP

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Saúde: provider ativo, circuito, status da SessionStore |
| `GET` | `/metrics` | Métricas Prometheus (text/plain) |
| `POST` | `/webhooks/suri` | Mensagem do cliente recebida do SURI |
| `POST` | `/webhooks/payment` | Notificação de pagamento do gateway |
| `POST` | `/webhooks/crm/follow-up` | Reengajamento disparado pelo CRM (recuperação de venda) |

Exemplo `/health`:

```json
{
  "ok": true,
  "provider": "groq",
  "circuitOpen": false,
  "sessionStore": { "type": "redis", "size": 3, "fallbackActive": false }
}
```

---

## 6. Cadastro de Webhooks na Plataforma SURI e no Gateway de Pagamento

Use a URL pública da aplicação no lugar de `https://SUA-INSTANCIA`:

### 6.1 Plataforma SURI (mensagens do WhatsApp)

**URL:** `https://SUA-INSTANCIA/webhooks/suri`

Cadastre essa URL no SURI como webhook de **mensagens recebidas** (`event = message`).
Payload de entrada validado pelo schema `suriInboundSchema`:

```json
{
  "event": "message",
  "channel": "whatsapp",
  "ticketId": "TKT-123",
  "customer": { "id": "CUST-1", "phone": "+5511987654321", "name": "Cliente" },
  "message": { "id": "MSG-1", "type": "text", "text": "Quero montar um PC gamer", "timestamp": "2026-08-06T12:00:00Z" },
  "context": { "ticketId": "TKT-123", "locale": "pt-BR", "timezone": "America/Sao_Paulo" },
  "receivedAt": "2026-08-06T12:00:00Z"
}
```

Resposta `200` com a réplica (`suriBotResponseSchema`):
`{ "reply": {...}, "ticketUpdate": {...} }`.

### 6.2 Gateway de Pagamento (confirmação de pagamento)

**URL:** `https://SUA-INSTANCIA/webhooks/payment`

Cadastre essa URL no gateway para o evento **`payment.confirmed`**.
Se `PAYMENT_WEBHOOK_SECRET` estiver definido, o gateway deve enviar o header
`x-signature: sha256=<HMAC-SHA256 do corpo bruto com o segredo>`. Payload:

```json
{
  "event": "payment.confirmed",
  "method": "pix",
  "chargeId": "CHARGE-1",
  "orderId": "ORDER-123",
  "ticketId": "TKT-123",
  "amountCents": 489990,
  "paidAt": "2026-08-06T12:05:00Z"
}
```

Resposta `200`: `{ "orderId": "ORDER-123", "orderStatus": "awaiting_nf", "botState": "PAYMENT_CONFIRMED" }`.

### 6.3 CRM (reengajamento / "Agente Duradouro")

**URL:** `https://SUA-INSTANCIA/webhooks/crm/follow-up`

Cadastre essa URL no CRM para recuperar vendas paradas (ex.: carrinho há +2 horas).
Payload:

```json
{
  "ticketId": "TKT-123",
  "reason": "abandoned_cart",
  "message": "Opcional - texto customizado de recuperação"
}
```

Resposta `200`: `{ "ok": true, "ticketId": "TKT-123", "botState": "STOCK_AND_FREIGHT" }`
(`404` se a sessão não existir, `400` se o payload for inválido). O handler recupera a
sessão no SessionStore e dispara a mensagem via SURI (WhatsApp do cliente).

---

## 7. Procedimento do vendedor (loja física)

Quando o pagamento é confirmado, o sistema:

1. Avança a FSM para `PAYMENT_CONFIRMED`;
2. Cria o pedido no ERP com **status `awaiting_nf`** (`POST /orders` do ERP);
3. Atualiza o ticket no SURI para `awaiting_nf` e envia ao cliente:
   > "Pagamento confirmado! Pedido ORDER-123 criado. Um vendedor fará a separação e emitirá a nota fiscal em breve."
4. As travas de estoque do checkout são liberadas automaticamente quando o PIX
   expira (job `paymentExpiryJob`, 15s de varredura) — assim o estoque nunca fica preso.

**Rotina do vendedor:**

1. Abra o **ERP** e filtre os pedidos com status **"Aguardando NF"** (`awaiting_nf`);
2. Separe os itens no estoque físico conferindo SKU, quantidade e a reserva da venda;
3. Emita a **Nota Fiscal** da venda;
4. Dê a **baixa** no ERP marcando o pedido como `nf_issued` (o item sai do saldo);
5. Atualize o ticket no SURI para `closed` (ou deixe `awaiting_nf` enquanto o item
   não é despachado), confirmando a emissão da NF ao cliente se desejar.

> A responsabilidade da separação e da emissão da NF é humana por decisão de negócio:
> o robô entrega a venda paga pronta para o vendedor apenas conferir e faturar.

---

## 8. Testes e validação

```bash
npm run typecheck   # TypeScript sem emitir
npm test            # Vitest (unit + e2e HTTP + FSM + sessão)
npm run build       # compila dist/
npm run check:env   # pré-checagem das variáveis de ambiente
npm run e2e         # e2e real com Groq/Gemini (exige chaves no .env)
```

---

## 9. Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| Boot aborta com erro Zod | Falta `GROQ_API_KEY`/`GEMINI_API_KEY` — rode `npm run check:env` |
| `[boot] ... Redis ... nao respondeu ao ping` | `SESSION_STORE=redis` sem Redis no `REDIS_URL`; suba o compose ou ajuste a URL |
| IA caiu | Circuit breaker troca para o Gemini (fallback) e retorna ao Groq após backoff; veja `/metrics` |
| Cliente não recebe resposta | Confira o `SURI_WEBHOOK_TOKEN` e se a URL `/webhooks/suri` está cadastrada no SURI |
| Webhook de pagamento dá 400 | Assinatura `x-signature` inválida ou `PAYMENT_WEBHOOK_SECRET` divergente |
| Pedido preso em "Aguardando NF" | Vendedor precisa emitir a NF e dar baixa no ERP (item 7) |
