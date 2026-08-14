# ============================================================================
# Dockerfile multi-stage do app Next.js (@loja/app) dentro do monorepo.
# Usa o output "standalone" do Next para uma imagem final minima.
# ============================================================================

# ---------- 1/3: dependencias ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/catalog/package.json packages/catalog/
COPY apps/agent/package.json apps/agent/
COPY apps/app/package.json apps/app/
RUN npm ci --no-audit --no-fund

# ---------- 2/3: build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/db ./packages/db
COPY packages/catalog ./packages/catalog
COPY apps/app ./apps/app
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @loja/catalog
RUN npm run build -w @loja/db
RUN npm run build -w @loja/app

# ---------- 3/3: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/apps/app/.next/standalone ./
COPY --from=build /app/apps/app/.next/static ./apps/app/.next/static

EXPOSE 3000
USER node

CMD ["node", "apps/app/server.js"]
