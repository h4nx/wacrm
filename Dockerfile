# ============================================================
# Convix — imagen autocontenida (Next.js standalone)
# Corre en cualquier host de contenedores; solo necesita un
# PostgreSQL alcanzable vía DATABASE_URL.
# ============================================================

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_APP_LOCALE decide qué mensajes carga src/i18n/request.ts.
# /login (y otras páginas de auth) se prerenderizan como HTML estático en
# este build — no alcanza con setearla solo en runtime (docker-compose
# `environment:`), porque para entonces el HTML ya quedó congelado con lo
# que haya en build time. default a "en" si no se pasa nada.
ARG NEXT_PUBLIC_APP_LOCALE=en
ENV NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S convix && adduser -S convix -G convix

COPY --from=build --chown=convix:convix /app/.next/standalone ./
COPY --from=build --chown=convix:convix /app/.next/static ./.next/static
COPY --from=build --chown=convix:convix /app/public ./public
# Migraciones + runner (el entrypoint las aplica antes de arrancar).
COPY --from=build --chown=convix:convix /app/db ./db
COPY --from=build --chown=convix:convix /app/scripts/migrate.mjs ./scripts/migrate.mjs

# Storage local por defecto (montar un volumen en /app/data).
RUN mkdir -p /app/data/storage && chown -R convix:convix /app/data

USER convix
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
