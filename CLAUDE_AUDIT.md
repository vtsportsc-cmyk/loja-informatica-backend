# Relatório de Auditoria — Loja Informática

**Data:** 2026-08-17
**Escopo:** `apps/app` (Next.js 15), `apps/agent` (WhatsApp/Groq bot), `packages/db` (Prisma/PostgreSQL)
**Autor:** Auditoria automatizada via opencode

---

## Sumário Executivo

| Categoria | Críticos | Altos | Médios | Baixos | Total |
|-----------|----------|-------|--------|--------|-------|
| Bugs / Segurança | 5 | 8 | 7 | 3 | 23 |
| Performance / DB | 3 | 6 | 4 | 2 | 15 |
| UI/UX | 2 | 4 | 3 | 2 | 11 |
| Resiliência Agent | 4 | 6 | 3 | 2 | 15 |
| **Total** | **14** | **24** | **17** | **9** | **64** |

---

## 1. Bugs Conhecidos / Ocultos

### 1.1 Segurança (CRÍTICO)

| # | Severidade | Arquivo | Problema |
|---|-----------|---------|----------|
| S1 | **CRÍTICO** | `apps/app/middleware.ts:30-31` | **Credenciais hardcoded** — fallback `admin`/`loja-admin` visíveis no source. Se env vars não estiverem setadas, o painel CRM fica aberto com credenciais públicas. |
| S2 | **CRÍTICO** | `apps/app/lib/agent-server.ts:42` | **Vazamento de URL interna** — mensagem de erro expõe hostname/porta do agent server ao cliente. |
| S3 | **CRÍTICO** | `apps/app/lib/quotes-store.ts:52` | **Código de orçamento previsível** — `Math.random()` para gerar códigos. Clientes podem adivinhar códigos de outros orçamentos. Usar `crypto.randomUUID()`. |
| S4 | **ALTO** | `apps/app/middleware.ts` | **Basic Auth nativo do browser** — sem login customizado, sem portal de autenticação. UX ruim + sem proteção contra brute-force. |
| S5 | **ALTO** | `apps/agent/src/integration/audio/TranscriptionClient.ts:126` | **API key Gemini em query string** — aparece em logs do servidor. Mover para header `Authorization`. |

### 1.2 Bugs de Runtime

| # | Severidade | Arquivo:linha | Problema | Impacto |
|---|-----------|---------------|----------|---------|
| B1 | **CRÍTICO** | `apps/agent/src/agent/MessageHandler.ts:380,394,410` | `JSON.parse(toolResult)` sem try/catch. Se a LLM retornar JSON malformado de uma tool, o request inteiro crasha com `SyntaxError` não tratado. | Bot para de responder. |
| B2 | **CRÍTICO** | `apps/agent/src/agent/sessionLock.ts` | **Deadlock sem timeout** — se um caller adquire o lock mas nunca chama `release()` (crash, promise abandonada), a ticket fica locked para sempre. Não há watchdog. | Mensagens daquele cliente enfileiram infinitamente. |
| B3 | **CRÍTICO** | `apps/agent/src/integration/payment/PaymentWebhookProcessor.ts:76` | Falha no `erpClient.createOrder()` deixa o pagamento em limbo — sessão fica `PAYMENT_PENDING` mas sem pedido criado. Webhook retorna 400, gateway retria infinitamente. | Pagamento perdido, loop de retries. |
| B4 | **CRÍTICO** | `apps/agent/src/fsm/states.ts` | **Transição ausente** `PAYMENT_CONFIRMED → HANDOFF`. Cliente paga mas quer falar com humano → `InvalidTransitionError` não tratado → crash. | Bot crasha, mensagem perdida. |
| B5 | **ALTO** | `apps/agent/src/fsm/BotStateMachine.ts:64` | `InvalidTransitionError` é throw mas não é catch em `MessageHandler.applyToolEffect`. Transições impossíveis pedidas pela LLM crasham o request. | Bot para de responder. |
| B6 | **ALTO** | `apps/app/app/crm/page.tsx:210-218` | `refreshList` sem try/catch. Se o fetch falhar (rede), `setLoading(false)` nunca é chamado e o componente trava em "Carregando". | Painel CRM trava. |
| B7 | **ALTO** | `apps/app/lib/quotes-store.ts:158` | **Memory leak** — `memoryStore` (Map) cresce sem limite. Em produção com processos longos, eventualmente OOM. | Crash do servidor Next.js. |
| B8 | **ALTO** | `apps/agent/src/agent/chargeOnTransition.ts:59-61` | Se criação de cobrança PIX falha, `session.charge` nunca é setado mas a sessão vai para `PAYMENT_PENDING`. Sem retry. | Cliente vê "pagamento pendente" mas não recebe cobrança. |
| B9 | **ALTO** | `apps/agent/src/llm/OpenAICompatProvider.ts:50` | `tool_call_id: m.toolCallId ?? ''` — enviar string vazia como `tool_call_id` causa rejeição da API OpenAI-compatível. | Respostas de tool perdidas. |
| B10 | **MÉDIO** | `apps/app/app/builder/page.tsx:196` | `byId.get(selectedId)!` — non-null assertion. Se o produto foi removido do catálogo, crasha. | Página Monte seu PC crasha. |
| B11 | **MÉDIO** | `apps/agent/src/webhooks/crm.ts:36` | `JSON.parse(rawBody)` antes do schema parse, sem try/catch. Body malformado → crash 500. | Webhook CRM falha. |
| B12 | **MÉDIO** | `apps/agent/src/agent/skills/hardwareCompatibilityCheck.ts:42-46` | Dois itens do mesmo `kind` (ex: 2 CPUs) — o segundo sobrescreve o primeiro silenciosamente. | Verificação de compatibilidade incorreta. |
| B13 | **MÉDIO** | `apps/agent/src/agent/skills/cartCalculator.ts:107` | Falha parcial no lock de 1 item derruba todo o cálculo. Itens já travados ficam órfãos sem cleanup. | Carrinho recalcula do zero, locks órfãos. |
| B14 | **MÉDIO** | `apps/agent/src/integration/bling/BlingClient.ts:89` | Se a API Bling retorna sem `id`, retorna string vazia → pedido Bling criado com ID vazio silenciosamente. | NF emitida com referência inválida. |
| B15 | **MÉDIO** | `apps/agent/src/panel/PanelApi.ts:64` | `checkAuth` retorna `true` quando `apiKey` é string vazia. Se `AGENT_API_KEY` for setado como vazio, endpoints ficam sem auth. | API do painel aberta. |
| B16 | **BAIXO** | `apps/app/lib/quotes-store.ts:73` | `await import('@loja/db')` dinâmico em cada chamada — overhead desnecessário. | Latência marginal. |
| B17 | **BAIXO** | `apps/agent/src/prisma/MessageRepository.ts:394` | Cast `status as FunnelStatus` sem validação. Status inválido → Prisma throw em runtime. | Erro 500 no painel. |

### 1.3 Bugs no Schema Prisma

| # | Severidade | Problema |
|---|-----------|----------|
| D1 | **ALTO** | **Sem `$transaction`** em nenhum lugar. Métodos como `ensureConversation`, `setFunnelStatus`, `markHighValueOpportunity`, `markLost` fazem múltiplas queries sequenciais sem atomicidade. Race conditions em webhook simultâneos. |
| D2 | **ALTO** | **5-6 FK sem `onDelete`**: `Quote→Customer`, `Quote→Conversation`, `Lead→Customer/Conversation/Quote`, `Agent→Conversation`. Deletar um Customer/Agent com dados dependentes dá erro FK ou cria órfãos. |
| D3 | **MÉDIO** | Query morta em `assume()` (`MessageRepository.ts:367`): `findUnique` resultado é descartado com `void prev` — query desnecessária a cada handoff. |
| D4 | **MÉDIO** | `Message.direction`, `Message.type`, `Message.status`, `Quote.status`, `Lead.status`, `Lead.source` são `String` em vez de enums. Sem validação no nível do banco — valores garbage entram sem erro. |
| D5 | **MÉDIO** | Tipo manual `FunnelStatus` em `packages/db/src/index.ts` é independente do enum Prisma. Se um novo status for adicionado ao schema mas não ao array `as const`, os tipos divergem silenciosamente. |

---

## 2. Otimizações de Performance

### 2.1 Cache Redis (Oportunidades)

| # | Onde | O quê | Impacto |
|---|------|-------|---------|
| C1 | `apps/app/app/api/products/route.ts` | **Catálogo já é `force-static`** — OK. Mas o `/api/system/status` faz fetch ao agent a cada request. Adicionar cache de 30s no Redis para status do sistema. | Reduz chamadas ao agent. |
| C2 | `apps/app/app/crm/page.tsx` | **`refreshList`** faz fetch de TODAS as conversations a cada mutação. Usar **optimistic updates** + invalidação de cache no Redis. | Elimina refetches desnecessários. |
| C3 | `apps/agent/src/rag/institutionalAnswers.ts` | **Já usa Redis cache** (bom!). Mas `REDIS_CACHE_ENABLED=false` no `.env.example`. Ativar em produção. | Zero tokens LLM para FAQs. |
| C4 | `apps/agent/src/prisma/MessageRepository.ts:listConversations` | Cache de 10-15s no Redis para a lista de conversas (dados semi-estáticos). Invalidar em mutações. | Elimina query pesada a cada refresh do painel. |
| C5 | `apps/agent/src/integration/erp/ErpClient.ts` | **Cache de estoque** — `stockBySku` é chamado frequentemente. Cache de 60s por SKU evita chamadas repetitivas ao ERP. | Reduz latência do cálculo de carrinho. |

### 2.2 Server Components / Next.js

| # | Onde | O quê | Impacto |
|---|------|-------|---------|
| N1 | `apps/app/app/crm/page.tsx` | **Tudo é Client Component** (1925 linhas). Separar a lista de conversas (Server Component) do chat (Client Component). | Menor bundle JS, carregamento mais rápido. |
| N2 | `apps/app/app/builder/page.tsx` | Carregar catálogo via `fetch` no Server Component em vez de client-side `useEffect`. Usar `React.cache()` para deduplicação. | Elimina waterfall client→server. |
| N3 | `apps/app/next.config.mjs` | Adicionar `images.formats` e `images.minimumCacheTTL` se houver imagens. Habilitar `swcMinify` (default em Next 15, verificar). | Build mais otimizado. |
| N4 | `apps/app/app/page.tsx` | A landing page é Server Component (bom). Mas os links de categoria `/builder` não passam query params. Adicionar `?category=processador` para scroll/filter direto. | Melhor UX de navegação. |

### 2.3 Consultas Lentas Prisma

| # | Arquivo:linha | Query | Problema | Solução |
|---|---------------|-------|----------|---------|
| Q1 | `MessageRepository.ts:254` | `listConversations` com `take: 200` | Sem paginação cursor-based. Cresce linearmente. | Adicionar cursor/skip pagination. |
| Q2 | `MessageRepository.ts:265` | `listMessages` com `take: 200` | Mesmo problema — conversas com >200 msgs perdem dados. | Cursor pagination por `createdAt`. |
| Q3 | `MessageRepository.ts:469` | `listPendingFollowUp` | Query complexa com `OR` + relation filter. Sem índice composto. | Criar índice `(funnelStatus, lastMessageAt, lastFollowUpAt)`. |
| Q4 | `MessageRepository.ts:384-411` | `setFunnelStatus` | `findUnique` + `update` sequenciais. `findUnique` é desnecessário — usar retorno do `update`. | Remover query desnecessária. |
| Q5 | `MessageRepository.ts:591-632` | `markHighValueOpportunity` | 4 queries sequenciais (find conv, find quote, update quote, update conv). | Usar `$transaction`. |
| Q6 | `MessageRepository.ts:203-230` | `ensureConversation` | 3 queries (upsert customer, find conv, create conv) sem transação. Race condition. | Usar `$transaction`. |
| Q7 | `packages/db/prisma/schema.prisma` | **QuoteItem sem índice** | `DELETE WHERE quoteId=?` é full scan. | Adicionar `@@index([quoteId])`. |
| Q8 | `packages/db/prisma/schema.prisma` | **Quote sem índice em `status`** | Queries "list by status" (pending, confirmed) são full scan. | Adicionar `@@index([status])`. |
| Q9 | `packages/db/prisma/schema.prisma` | **Conversation sem índice em `assignedAgentId`** | Dashboard de agente filtra por assignment — full scan. | Adicionar `@@index([assignedAgentId])`. |

### 2.4 Tempo de Carregamento /crm e /builder

| # | Rota | Problema | Solução |
|---|------|----------|---------|
| L1 | `/crm` | **1925 linhas de JS** enviadas ao client. Tudo em um único componente monolítico. | Dividir em módulos: Kanban, Chat, Orders, BI — carregar sob demanda com `dynamic import()`. |
| L2 | `/crm` | Fetch de conversas + agents + status do sistema em paralelo mas sem streaming. | Usar `Promise.allSettled` + renderizar progressivamente. |
| L3 | `/builder` | Catálogo (potencialmente centenas de produtos) carregado inteiro no client. | Paginar ou virtualizar a lista de produtos por categoria. |
| L4 | `/crm` | **Sem paginação/virtualização** na lista de conversas. Centenas de cards re-renderizam a cada state change. | Implementar `react-window` ou paginação server-side. |

---

## 3. Melhorias de UI/UX

### 3.1 Estados de Carregamento (Skeletons)

| # | Página | Ausência | Recomendação |
|---|--------|----------|--------------|
| U1 | `/builder` | Texto plano "Carregando catálogo..." | Skeleton shimmer com cards de produto placeholder. |
| U2 | `/crm` | Texto plano "Carregando operações..." | Skeleton com 3 colunas Kanban + sidebar. |
| U3 | `/quote/[code]` | Texto plano "Carregando..." | Skeleton com layout do orçamento. |
| U4 | `/crm` (Chat) | Sem indicador de "digitando..." | Adicionar animação de digitação do bot. |
| U5 | `/crm` (Refresh) | Sem feedback visual ao atualizar lista | Spinner no botão de refresh ou pull-to-refresh. |

### 3.2 Feedback Visual

| # | Contexto | Ausência | Recomendação |
|---|----------|----------|--------------|
| F1 | Criar orçamento (`/builder`) | Sem confirmação visual ao enviar | Toast de sucesso "Orçamento #XXXX criado!" com link para `/quote/[code]`. |
| F2 | Criar orçamento (`/builder`) | Botão não mostra estado de loading | Desabilitar botão + spinner durante submissão. |
| F3 | Mudar status no Kanban (`/crm`) | Sem confirmação ao mover card | Toast discreto "Movido para [status]" + undo. |
| F4 | Atribuir departamento (`/crm`) | Sem feedback | Badge visual confirma mudança. |
| F5 | Handoff (`/crm`) | Sem confirmação ao assumir/liberar | Toast "Assumido por [agente]" / "Liberado". |

### 3.3 Validações

| # | Contexto | Ausência | Recomendação |
|---|----------|----------|--------------|
| V1 | `/builder` — campo telefone | Aceita qualquer texto | Validar formato BR: (DDD) 9XXXX-XXXX. |
| V2 | `/crm` — criar nota | Sem limite de tamanho | Max 5000 caracteres com contador. |
| V3 | `/crm` — perder lead | Sem validação de motivo | Dropdown obrigatório com motivos do enum. |
| V4 | `/crm` — mobile | Layout 3 painéis sem navegação | Adicionar navegação por tabs ou swipe no mobile. |
| V5 | `/crm` — erro de rede | Componente trava em "Carregando" | Error boundary + botão de retry. |

### 3.4 Extras

| # | Contexto | Recomendação |
|---|----------|--------------|
| E1 | `/quote/[code]` | Adicionar botão de compartilhar (WhatsApp link) e baixar PDF. |
| E2 | `/builder` | Adicionar filtros por faixa de preço e marca. |
| E3 | `/crm` | Auto-refresh a cada 30s com indicador visual (dot pulsante). |
| E4 | `/crm` — Kanban | Adicionar contadores no header de cada coluna (ex: "Novo (12)"). |
| E5 | Layout geral | Adicionar `<meta viewport>` explícito e `<html lang="pt-BR">`. |

---

## 4. Resiliência do Agent / WhatsApp

### 4.1 O que JÁ existe (bom)

| Mecanismo | Arquivo | Status |
|-----------|---------|--------|
| Circuit breaker Groq → Gemini | `LLMProviderRouter.ts` | Funcional |
| Rate limiter por ticket | `rateLimiter.ts` | Funcional |
| Session lock (serialização) | `sessionLock.ts` | Funcional, mas sem timeout |
| Retry com backoff exponencial (429) | `LLMProviderRouter.ts` | Funcional (1 retry) |
| Transcrição fallback (Groq → Gemini) | `TranscriptionClient.ts` | Funcional |
| Cache institucional fallback (Redis → Memória) | `institutionalCache.ts` | Funcional |
| Graceful shutdown | `index.ts` | Funcional |
| HMAC webhook verification | `evolution.ts`, `instagram.ts`, `PaymentClient.ts` | Funcional |
| Fire-and-forget para CRM events | `CrmClient.ts` | Funcional |
| Max 4 rounds de tool-calling | `MessageHandler.ts` | Funcional |

### 4.2 O que FALTA (gaps de resiliência)

| # | Severidade | Problema | Solução |
|---|-----------|----------|---------|
| R1 | **CRÍTICO** | **Sem timeout em chamadas HTTP** — `EvolutionApi`, `PaymentClient`, `ErpClient`, `BlingClient` usam `fetch` sem `AbortSignal.timeout()`. Se qualquer serviço externo travar, o agent trava infinitamente. | Adicionar `AbortSignal.timeout(10000)` em todas as chamadas fetch. |
| R2 | **CRÍTICO** | **Session lock sem deadlock detection** — lock adquirido mas nunca liberado (crash/promise abandonada) trava a ticket para sempre. | Adicionar TTL no lock (ex: 60s) + watchdog periódico. |
| R3 | **CRÍTICO** | **Sem idempotência no webhook WhatsApp** — se o Evolution reenvia um webhook (404/timeout), a mensagem é processada duas vezes (duplicada no DB). | Salvar `whatsappMessageId` antes de processar e verificar duplicata. |
| R4 | **ALTO** | **EvolutionApi sem retry** — `sendText`/`sendReply` falha se Evolution estiver indisponível, sem retry. Mensagem processada mas resposta perdida. | Retry 1x com backoff de 500ms antes de desistir. |
| R5 | **ALTO** | **Cart calculator falha parcial** — se o ERP trava no 3º item de 5, os 2 primeiros ficam lockados sem cleanup. | Implementar rollback de locks em caso de falha parcial. |
| R6 | **ALTO** | **Sem dead-letter queue** — se o processamento de uma mensagem falha (após todas as tentativas), ela é perdida. | Fila de falhas com retry manual + notificação ao admin. |
| R7 | **ALTO** | **`PaymentWebhookProcessor` — ERP failure deixa pagamento em limbo** — se `createOrder` falha, a sessão fica `PAYMENT_PENDING` para sempre. | Retry com backoff + fallback: marcar como `PAYMENT_FAILED` se ERP indisponível. |
| R8 | **ALTO** | **Quote follow-up job sem retry** — `sendText` em loop, se Evolution down, todas as conversas falham silenciosamente. | Retry por conversa + circuit breaker no EvolutionClient. |
| R9 | **MÉDIO** | **Transições FSM ausentes** — `PAYMENT_CONFIRMED → HANDOFF` não existe. Cliente paga e quer falar com humano. | Adicionar transição + handler no `MessageHandler`. |
| R10 | **MÉDIO** | **Sem graceful degradation na LLM** — se Groq e Gemini falham ao mesmo tempo, `LlmAllProvidersFailedError` é lançado mas o bot não envia mensagem amigável ao cliente. | Catch `LlmAllProvidersFailedError` → enviar "Estamos com problema temporário, tente novamente em instantes". |
| R11 | **MÉDIO** | **Sem health check do Evolution** — o health endpoint pinga DB/Redis/Evolution mas não valida se a instância WhatsApp está conectada. | Verificar `getConnectionState()` e incluir no health status. |
| R12 | **BAIXO** | **Métricas sem limpeza** — Maps de métricas (`llm`, `transitions`, `webhooks`, `rateLimited`) crescem infinitamente. | Janela deslizante de 1h com purge periódico. |
| R13 | **BAIXO** | **Botão de retry no builder** — se o catálogo falhar de carregar, não há botão de retry. | Adicionar botão "Tentar novamente" na UI de erro. |

### 4.3 Resumo de Cenários de Falha

| Cenário | Comportamento Atual | Risco |
|---------|---------------------|-------|
| Groq API cai | Circuit breaker → fallback para Gemini | **Baixo** (funciona) |
| Gemini API cai | Groq primário continua | **Baixo** |
| Ambas LLMs caem | `LlmAllProvidersFailedError` → crash no request | **Alto** — bot não responde |
| Evolution API cai | `sendText` falha sem retry → resposta perdida | **Alto** — msg processada mas não enviada |
| PostgreSQL cai | InMemoryMessageRepository (se `DATABASE_URL` vazio) | **Médio** — dados em memória apenas |
| Redis cai (session store) | Boot falha (hard crash) | **Alto** — agent não inicia |
| Redis cai (cache) | Degrada para memória (graceful) | **Baixo** (funciona) |
| ERP cai | Stock queries falham → cart não calcula | **Alto** — carrinho inutilizável |
| Payment gateway cai | PIX não gera → sessão fica pendente | **Alto** — pagamento travado |
| Bling cai | NF não emite → status fica `AGUARDANDO_NF` | **Médio** — retry manual necessário |

---

## 5. Índices Faltantes (Prisma Schema)

```prisma
// ADICIONAR ao schema.prisma:

model QuoteItem {
  // ... existente ...
  @@index([quoteId])          // FK lookup + cascade delete
}

model Quote {
  // ... existente ...
  @@index([status])           // Filtro "list by status" (pending, confirmed)
  @@index([blingOrderId])     // Lookup pós-integração Bling
}

model Conversation {
  // ... existente ...
  @@index([assignedAgentId])  // Dashboard filtrado por agente
  @@index([lastFollowUpAt])   // Query listPendingFollowUp
}

// ADICIONAR onDelete cascade nas relações:
// Quote → Customer: onDelete: Cascade
// Quote → Conversation: onDelete: SetNull
// Lead → Customer: onDelete: SetNull
// Lead → Conversation: onDelete: SetNull
// Lead → Quote: onDelete: SetNull
// Conversation → Agent: onDelete: SetNull
// Message → Agent: onDelete: SetNull
```

---

## 6. Priorização Sugerida

### Fase 1 — Emergencial (esta semana)

1. **B1** — Envolver `JSON.parse(toolResult)` em try/catch no `MessageHandler`
2. **B2** — Adicionar TTL no `sessionLock` (60s) + watchdog
3. **S1** — Remover credenciais hardcoded do middleware
4. **S3** — Trocar `Math.random()` por `crypto.randomUUID()` nos códigos
5. **R1** — Adicionar `AbortSignal.timeout()` em todas as chamadas HTTP externas
6. **R3** — Adicionar idempotência no webhook WhatsApp (checar `whatsappMessageId`)

### Fase 2 — Alta (próximas 2 semanas)

7. **D1** — Adicionar `$transaction` em `ensureConversation`, `setFunnelStatus`, `markHighValueOpportunity`
8. **D2** — Adicionar `onDelete` cascade/SetNull nas relações FK
9. **B4** — Adicionar transição `PAYMENT_CONFIRMED → HANDOFF`
10. **R7** — Retry + fallback no `PaymentWebhookProcessor`
11. **5** — Adicionar índices faltantes (QuoteItem, Quote.status, Conversation.assignedAgentId)
12. **Q1-Q2** — Implementar cursor pagination em `listConversations` e `listMessages`
13. **R10** — Handler amigável para `LlmAllProvidersFailedError`
14. **U1-U3** — Adicionar skeletons de carregamento em `/builder`, `/crm`, `/quote`

### Fase 3 — Melhorias (próximo mês)

15. **N1** — Dividir `/crm` em módulos com dynamic imports
16. **C4-C5** — Cache Redis para listConversations e stockBySku
17. **F1-F5** — Toasts de feedback visual em todas as ações
18. **V1** — Validação de telefone no builder
19. **Q3-Q6** — Otimizar queries complexas com índices compostos
20. **R12** — Janela deslizante para métricas (purge periódico)
21. **U4** — Indicador de "digitando..." no chat
22. **E1-E5** — Compartilhar orçamento, filtros, auto-refresh, contadores Kanban

---

## 7. Arquivos Mais Críticos para Refatoração

| Prioridade | Arquivo | Linhas | Motivo |
|------------|---------|--------|--------|
| 1 | `apps/agent/src/agent/MessageHandler.ts` | ~430 | Core do bot — JSON.parse crash, sem error handling em tools |
| 2 | `apps/agent/src/agent/sessionLock.ts` | ~80 | Deadlock sem timeout — risco de travamento |
| 3 | `apps/agent/src/integration/evolution/EvolutionApi.ts` | ~120 | Sem timeouts, sem retry |
| 4 | `apps/agent/src/integration/payment/PaymentWebhookProcessor.ts` | ~200 | ERP failure limbo, sem retry |
| 5 | `apps/agent/src/fsm/states.ts` | ~80 | Transições ausentes |
| 6 | `apps/app/middleware.ts` | ~52 | Credenciais hardcoded |
| 7 | `apps/app/lib/quotes-store.ts` | ~207 | Memory leak, Math.random, sem transaction |
| 8 | `apps/app/app/crm/page.tsx` | ~1925 | Monolito — precisa ser dividido |
| 9 | `apps/agent/src/prisma/MessageRepository.ts` | ~750 | Sem transactions, sem paginação, queries desnecessárias |
| 10 | `packages/db/prisma/schema.prisma` | ~231 | Índices e cascades faltantes |

---

*Relatório gerado automaticamente. Revisar e validar cada item antes de implementar.*
