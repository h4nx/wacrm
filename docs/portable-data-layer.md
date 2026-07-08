# Capa de datos portable (post-Supabase)

wacrm nació como template sobre Supabase. En la edición H&M Business
se eliminó esa dependencia: la app corre contra **cualquier
PostgreSQL** y **cualquier servidor Node**, sin cambiar el código de
features. Este documento explica cómo.

## Qué reemplazó a qué

| Rol (era Supabase)    | Reemplazo portable                                        |
| --------------------- | --------------------------------------------------------- |
| PostgREST + anon key  | Builder compatible (`src/lib/db/`) + `POST /api/db`       |
| RLS con `auth.uid()`  | Las MISMAS políticas RLS con `app_uid()` (GUC por sesión) |
| Service-role key      | `createServiceClient()` — el pool es dueño del esquema    |
| Supabase Auth         | Sesiones propias (`sessions`, scrypt) + OIDC opcional     |
| Realtime (websockets) | SSE `/api/realtime/sse` + `LISTEN/NOTIFY` (triggers)      |
| Storage (buckets)     | `/api/storage/*` con driver local o S3/MinIO              |
| `supabase db push`    | `npm run db:migrate` → `db/migrations/*.sql`              |

## El modelo de seguridad no cambió

La autorización sigue viviendo en Postgres como **Row Level Security**
(RLS es Postgres puro, no Supabase). El esquema (migración
`0001_init.sql`) conserva las 97 políticas originales, con dos cambios
mecánicos:

- `auth.uid()` → `app_uid()`, que lee el GUC `app.user_id`.
- `auth.users` → `public.users` (tabla propia).

Cada consulta iniciada por un usuario corre en una transacción con:

```sql
SET LOCAL ROLE wacrm_user;                    -- rol sin login, sujeto a RLS
SELECT set_config('app.user_id', $uid, true); -- quién actúa
```

Las rutas de servicio (webhook de Meta, motor de automatizaciones,
API pública con API keys) usan el pool sin `SET ROLE`: como dueño de
las tablas, evade RLS — exactamente la semántica del service-role.

Los RPC (`redeem_invitation`, `touch_presence`, …) conservan sus
firmas: son `SECURITY DEFINER` y leen `app_uid()` internamente. Desde
el navegador solo se permiten los de la allowlist en
`src/app/api/db/route.ts`.

## El builder compatible

El código de features siguió escrito contra el API de supabase-js:

```ts
const { data, error } = await supabase
  .from('conversations')
  .select('id, status, contact:contacts(name, phone)')
  .eq('account_id', accountId)
  .order('last_message_at', { ascending: false })
  .limit(50);
```

`createClient()` (server o browser) ya no habla con Supabase: el
builder acumula un **descriptor JSON** del query y lo ejecuta:

- **Servidor** (`src/lib/supabase/server.ts`): compila a SQL
  parametrizado (`src/lib/db/compile.ts`) y lo corre en el pool con el
  contexto RLS del usuario de la sesión.
- **Navegador** (`src/lib/supabase/client.ts`): manda el descriptor a
  `POST /api/db`, que autentica por cookie y ejecuta igual.

Cobertura del subconjunto usado por la app: filtros (`eq`, `neq`,
`gt(e)`, `lt(e)`, `like`, `ilike`, `is`, `in`, `contains`, `filter`
con accesores JSON `col->>x`), `.or()` con `and()` anidado y
comodines `*`, embeds `alias:tabla(cols)` (M:1 y 1:M, anidados, y
`!inner` con filtros punteados), `order/limit/range`,
`single/maybeSingle` (con `PGRST116`), `count: 'exact'` (+`head`),
mutaciones con `.select()` (RETURNING) y `upsert` con `onConflict`.
Los joins de embeds se infieren de `src/lib/db/fk-map.ts` — regenerar
si cambian las FKs (query en el propio archivo).

Tests: `src/lib/db/execute.integration.test.ts` corre contra un
Postgres real cuando `TEST_DATABASE_URL` está definida (CI lo hace
siempre).

## Realtime

Triggers `notify_change` (migración `0003`) emiten
`pg_notify('wacrm_changes', {table, op, id, account_id, user_id})`
en `messages`, `conversations`, `notifications` y `member_presence`.
Un broker por proceso (`src/lib/realtime/broker.ts`) escucha, rehidrata
la fila y la reparte a los SSE de los suscriptores de la misma cuenta
(y del mismo usuario para `notifications`). Los mensajes broadcast
(typing) viajan por `pg_notify('wacrm_broadcast', …)` vía
`POST /api/realtime/broadcast`, así funcionan con N instancias de la
app detrás de un balanceador.

El cliente (`src/lib/realtime/client.ts`) replica la superficie de
canales de supabase-js (`.channel().on('postgres_changes'|'broadcast')
.subscribe()`) sobre un único `EventSource`.

## Identidad

- `users` / `sessions` / `password_reset_tokens` / `oidc_identities`
  (sin GRANT para `wacrm_user`: solo el servidor las toca).
- Contraseñas: scrypt (N=2^15, r=8, p=1). Sesiones: token opaco de
  256 bits en cookie httpOnly; en la BD solo su SHA-256; expiración
  deslizante de 30 días.
- El trigger `on_user_created` (heredado de la era Supabase) crea
  cuenta + perfil `owner` en el signup.
- **OIDC opcional** (`OIDC_ISSUER_URL` + `OIDC_CLIENT_ID`): flujo
  authorization-code con PKCE contra Vaultex/Keycloak o cualquier
  proveedor estándar; auto-provisiona y vincula por email. El botón
  aparece solo en el login cuando está configurado.
- El middleware hace chequeos optimistas por presencia de cookie
  (guía de Next 16); la validación real está en el server layout del
  dashboard, en cada route handler y en RLS.

## Ecosistema H&M Business — eventos Kafka

`src/lib/events/kafka.ts` publica cada evento de dominio en el bus
compartido con la convención del ecosistema (`<producto>.<evento>`):

- `wacrm.message.received`
- `wacrm.message.status_updated`
- `wacrm.conversation.created`

El hook vive en `dispatchWebhookEvent`
(`src/lib/webhooks/deliver.ts`): todo evento que la app despacha a
sus webhooks HTTP salientes se espeja también a Kafka, con el
`account_id` como clave de partición y el mismo sobre
(`{event, account_id, occurred_at, data}`). Es best-effort — sin
`KAFKA_BROKERS` es un no-op y un broker caído jamás afecta el 200 al
webhook de Meta. Para añadir un evento nuevo basta añadirlo al
vocabulario de `src/lib/webhooks/events.ts` y despacharlo en su
origen, igual que antes.

Pendiente de fase 2: **consumir** eventos de otros productos
(`orbix.*` para enriquecer contactos, `vaultex.user.*` para
provisión de usuarios) — requiere un worker consumidor, no encaja en
el ciclo request/response de Next.

## Migrar una instalación Supabase existente

Con el esquema destino ya aplicado (`npm run db:migrate`):

```bash
SOURCE_DATABASE_URL='postgres://postgres:...@db.<proyecto>.supabase.co:5432/postgres' \
DATABASE_URL='postgres://...' \
node scripts/migrate-from-supabase.mjs
```

- Copia `auth.users` → `users` conservando ids y los hashes bcrypt de
  GoTrue; cada usuario entra con su contraseña de siempre y el hash
  se re-escribe a scrypt en su primer login.
- Copia las 34 tablas de `public` en orden de FKs, intersectando
  columnas (sin pgvector en destino, `embedding` se omite y la base
  de conocimiento queda en modo full-text).
- Los archivos de Storage se copian aparte: baja los buckets
  `avatars`, `flow-media` y `chat-media` de Supabase y colócalos en
  `STORAGE_LOCAL_PATH/<bucket>/…` (o en el S3/MinIO destino)
  conservando las rutas.
