# ============================================================
# wacrm — imagen autocontenida (Next.js standalone)
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
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S wacrm && adduser -S wacrm -G wacrm

COPY --from=build --chown=wacrm:wacrm /app/.next/standalone ./
COPY --from=build --chown=wacrm:wacrm /app/.next/static ./.next/static
COPY --from=build --chown=wacrm:wacrm /app/public ./public
# Migraciones + runner (el entrypoint las aplica antes de arrancar).
COPY --from=build --chown=wacrm:wacrm /app/db ./db
COPY --from=build --chown=wacrm:wacrm /app/scripts/migrate.mjs ./scripts/migrate.mjs

# Storage local por defecto (montar un volumen en /app/data).
RUN mkdir -p /app/data/storage && chown -R wacrm:wacrm /app/data

USER wacrm
EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
