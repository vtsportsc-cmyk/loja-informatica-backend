# ============================================================================
# Dockerfile multi-stage - loja-informatica-backend
#   Stage deps   : instala TODAS as dependencias (build requer typescript/tsx)
#   Stage build  : compila TypeScript e remove devDependencies (imagem final leve)
#   Stage runtime: imagem minima node:22-alpine, roda como usuario nao-root
# Para sessao distribuida, suba junto com o servico `redis` do docker-compose.
# ============================================================================

# ---------- 1/3: dependencias ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2/3: build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

# ---------- 3/3: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js"]
