# PROGRESSO / CONTINUAÇÃO (handoff)

Guia de retomada: o que já está pronto e o que falta quando as chaves da API forem preenchidas.

## Estado atual (100% verde)

- **Fase 1** — IA (Groq primário / Gemini fallback + circuit breaker), FSM, métricas Prometheus, rate limit, expiração PIX com liberação automática de estoque (15 min), RAG dinâmico, ferramentas (carrinho/frete/CEP/compatibilidade): concluída.
- **Fase 2** — `ISessionStore` (`InMemorySessionStore` + `RedisSessionStore` com TTL 30 min), histórico recente da conversa (10 msgs), endpoints HTTP (`/health`, `/metrics`, `/webhooks/suri`, `/webhooks/payment`): concluída.
- **Fase 3** — Dockerização (`Dockerfile` multi-stage + `docker-compose.yml` com Redis), `src/index.ts` (boot produção com validação Zod + Redis ping + shutdown gracioso), `scripts/check-env.ts`, README operacional, `PAYMENT_WEBHOOK_SECRET`: concluída.
- **Fase 4** — CRM `trycompai/crm` (Backstage/Gestão de Oportunidades): `CrmClient` (ICrmClient, timeout rígido ≤3s, `CRM_ENABLED=false` = no-op), eventos Zod `lead.created` / `pix.generated` / `pix.expired` / `sale.completed` disparados de forma **assíncrona e não-bloqueante** (nunca travam a FSM), e webhook `POST /webhooks/crm/follow-up` para reengajamento via SURI: concluída.
- **Preparação para apresentação** — Persona comercial profissional no `MessageHandler` (triagem → dúvidas → qualificação → oferta → handoff), base de FAQs (`src/rag/faq.ts` + `knowledge/faqs.json`) injetada no contexto do LLM, `.env` sincronizado com `.env.example`, e `.gitignore` ampliado (bloqueia `senhas servidor/`, arquivos `*.txt` e `.env`): concluída.

Validação executada:
- `npm run typecheck` ✓ · `npm test` (81/81) ✓ · `npm run build` ✓ · `npm run check:env` ✓
- `docker compose up --build -d` → app+redis healthy, sessão real gravada no Redis (TTL 1793s) ✓ (stack já derrubado)

## Chaves/API que faltam (preencher no `.env`)

Copiar do `.env.example` se a linha não existir:

| Variável | Onde gerar | Para quê |
|---|---|---|
| `ERP_API_TOKEN` | ERP da loja | autenticar consulta de estoque, travas e criação de pedidos |
| `SURI_WEBHOOK_TOKEN` | Plataforma SURI | responder/atualizar tickets no WhatsApp |
| `PAYMENT_API_KEY` | Gateway de pagamento | criar cobranças PIX/cartão e dar ACK do webhook |
| `PAYMENT_WEBHOOK_SECRET` | Gateway de pagamento | validar assinatura HMAC (`x-signature`) do webhook |
| `PIX_MERCHANT_KEY` | Banco/chave PIX | nome do recebedor no QR Code PIX |

CRM (Fase 4): `CRM_API_URL`, `CRM_API_TOKEN` e `CRM_ENABLED` já têm defaults que
rodam com mocks/stubs em dev (`CRM_ENABLED=false` = no-op silencioso). Para a loja,
defina `CRM_API_URL`/`CRM_API_TOKEN` reais e `CRM_ENABLED=true`.

Já configuradas no `.env`: `GROQ_API_KEY`, `GEMINI_API_KEY` (e defaults das demais).

## Próximos passos quando voltar

1. Preencher as 5 chaves acima no `.env`.
2. `npm run check:env` → tudo `ok`/`n/a`.
3. `npm run e2e` → E2E real (Groq + Gemini) com pedido `ORDER-E2E-1`; confirmar pedido "Aguardando NF" no ERP.
4. Cadastrar webhooks na plataforma com a URL pública final:
   - SURI: `POST https://SUA-INSTANCIA/webhooks/suri` (evento `message`)
   - Gateway: `POST https://SUA-INSTANCIA/webhooks/payment` (evento `payment.confirmed`, header `x-signature: sha256=...`)
   - CRM: `POST https://SUA-INSTANCIA/webhooks/crm/follow-up` (reengajamento/"Agente Duradouro" do trycompai/crm — dispara mensagem de recuperação via SURI)
5. Deploy 100% cloud: `cp .env.example .env` (chaves preenchidas) + `docker compose up --build -d` (sobe app + Redis; força `SESSION_STORE=redis`).

## Comandos úteis

```bash
npm run dev          # desenvolvimento (tsx, carrega .env)
npm start            # produção local (prestart: build + check:env, depois node dist/index.js)
npm run check:env    # pré-checagem Zod das variáveis
npm test             # 81 testes
npm run build        # compila dist/
npm run e2e          # E2E real com Groq/Gemini
docker compose up --build -d
docker compose logs -f app
docker compose down
```

## Notas

- Docker Desktop pode precisar ser iniciado manualmente antes do `docker compose up` (o build/compose foram validados nesta sessão).
- `PAYMENT_WEBHOOK_SECRET` vazio = webhook aceito sem assinatura (use sempre em produção).
- CRM (Fase 4): eventos são **fire-and-forget** (`emitCrmEvent` nunca rejeita; falha = `console.warn`). A FSM/atendimento nunca espera nem é interrompido pelo CRM. `pix.expired` é emitido dentro de `PaymentWebhookProcessor.expire` — que é exatamente o que o `paymentExpiryJob` aciona a cada varredura.
- Procedimento do vendedor (status "Aguardando NF"): separar estoque físico → emitir NF → dar baixa no ERP (`nf_issued`) → fechar ticket no SURI.
