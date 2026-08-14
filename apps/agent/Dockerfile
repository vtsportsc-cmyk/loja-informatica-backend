# ============================================================================
# Dockerfile multi-stage do agente (@loja/agent) dentro do monorepo.
#   deps   : npm ci com todos os workspaces
#   build  : prisma generate + build de @loja/catalog, @loja/db e @loja/agent
#   runtime: imagem minima node:22-alpine, roda como usuario nao-root
# ============================================================================

# ---------- 1/3: dependencias ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/catalog/package.json packages/catalog/
COPY apps/agent/package.json apps/agent/
RUN npm ci --no-audit --no-fund

# ---------- 2/3: build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/db ./packages/db
COPY packages/catalog ./packages/catalog
COPY apps/agent ./apps/agent
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @loja/catalog
RUN npm run build -w @loja/db
RUN npm run build -w @loja/agent
RUN npm prune --omit=dev --no-audit --no-fund

# ---------- 3/3: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/agent ./apps/agent
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/catalog ./packages/catalog

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health >/dev/null 2>&1 || exit 1

CMD ["node", "apps/agent/dist/index.js"]
