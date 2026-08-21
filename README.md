# Convix — CRM para WhatsApp · H&M Business

> CRM autoalojable para WhatsApp Business — inbox compartido,
> contactos, pipelines de venta, broadcasts y automatizaciones
> no-code. Parte del ecosistema **H&M Business** (Orbix · Xentry ·
> Partex · Sealix · Vaultex). Corre contra **cualquier PostgreSQL**
> y **cualquier servidor Node** — sin dependencias SaaS.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/h4nx/convix/actions/workflows/ci.yml/badge.svg)](https://github.com/h4nx/convix/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)

**Convix** es un fork del template
[ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) (MIT), reajustado
para el ecosistema H&M Business: se eliminó la dependencia de Supabase
(ver [docs/portable-data-layer.md](./docs/portable-data-layer.md)) y se
añadió SSO OIDC opcional contra Vaultex/Keycloak.

## Qué incluye

- **Inbox compartido** sobre la API oficial de WhatsApp Business —
  varios agentes en un número, asignación por conversación, estados y
  notas.
- **Contactos + tags + campos personalizados**, import CSV, dedupe.
- **Pipelines de venta** (Kanban) con deals ligados a conversaciones.
- **Broadcasts** con plantillas aprobadas por Meta, tracking de
  entrega/lectura, variables por destinatario.
- **Automatizaciones no-code** y **flujos** con builder visual.
- **Asistente de IA** (bring-your-own-key OpenAI/Anthropic, cifrado
  AES-256-GCM) con base de conocimiento — full-text siempre, semántica
  cuando hay pgvector.
- **Dashboard en tiempo real**, **cuentas de equipo** con roles
  (owner / admin / agent / viewer) e invitaciones por enlace.
- **API REST pública** (`/api/v1`) con API keys revocables — ver
  [docs/public-api.md](./docs/public-api.md).

## Requisitos

- Node.js ≥ 20
- PostgreSQL ≥ 14 (Docker, VPS, RDS, Neon… la extensión `pgvector`
  es opcional y solo habilita la búsqueda semántica de la base de
  conocimiento). El usuario de `DATABASE_URL` debe ser el dueño del
  esquema y tener `CREATEROLE` la primera vez.
- Opcionales: MinIO/S3 para archivos (por defecto: disco local),
  SMTP para emails de reseteo (en dev: Mailpit), Keycloak/Vaultex
  para SSO.

## Arranque rápido

```bash
git clone <tu-fork>
cd Convix
npm install

docker compose up -d db        # PostgreSQL 16 + pgvector en :5432
cp .env.local.example .env.local   # completa DATABASE_URL + Meta creds
npm run db:migrate             # aplica db/migrations/*
npm run dev
```

Abre <http://localhost:3000>, crea tu cuenta y listo. Para el stack
completo en contenedores (app + Postgres + MinIO + Mailpit):

```bash
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
META_APP_SECRET=... docker compose --profile full up -d
```

## Despliegue

La imagen (`Dockerfile`) es autocontenida: aplica las migraciones y
arranca. Solo necesita `DATABASE_URL` (y tus secretos) — corre en
cualquier host de contenedores, VPS con Docker, o Kubernetes. Sin
contenedor: `npm run build && npm start` en cualquier Node ≥ 20.

Variables de entorno: ver [.env.local.example](./.env.local.example).

Para un stack local completo (app en :11000 + Postgres + Kafka + MinIO
+ Mailpit) bajo el proyecto Docker `convix-dev`:

```bash
docker compose -p convix-dev -f docker-compose.local.yml \
  --env-file .env.convix-dev up -d --build
```

Antes de cada despliegue a producción — y especialmente si vienes de
una instancia con los nombres `wacrm` viejos — repasa
[docs/production-checklist.md](./docs/production-checklist.md).

## Ecosistema H&M Business

- **SSO**: define `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
  `OIDC_CLIENT_SECRET` apuntando al realm de Vaultex (Keycloak 24) y
  el login muestra "Continue with Vaultex". Sin esas variables, la
  app funciona standalone con email/contraseña.
- **Storage**: `STORAGE_DRIVER=s3` contra el MinIO compartido.
- **Eventos**: con `KAFKA_BROKERS` definido, cada evento de dominio se
  publica en `convix.<evento>` (message.received,
  message.status_updated, …) con el `account_id` como clave. Sin la
  variable es un no-op. Detalle en
  [docs/portable-data-layer.md](./docs/portable-data-layer.md).

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Datos** — PostgreSQL con Row Level Security (las políticas
  originales del template, ahora portables), capa de datos propia
  compatible con PostgREST, realtime vía SSE + LISTEN/NOTIFY.
- **Identidad** — sesiones propias (scrypt + cookie httpOnly) y OIDC
  opcional (Vaultex/Keycloak).
- **WhatsApp** — Meta Cloud API (WhatsApp Business API oficial).

## Seguridad

Cifrado de tokens AES-256-GCM, RLS en todas las tablas, webhooks
verificados por HMAC, CSP estricta, rate limiting, contraseñas con
scrypt, sesiones opacas hasheadas. Reportes: ver
[`.github/SECURITY.md`](./.github/SECURITY.md).

## Licencia

[MIT](./LICENSE) — Convix es un fork de
[ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) (MIT), cuya
atribución se conserva.
