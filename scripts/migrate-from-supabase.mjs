#!/usr/bin/env node
/**
 * Migra los DATOS de una instalación convix sobre Supabase a la base
 * portable (esquema de db/migrations ya aplicado con db:migrate).
 *
 *   SOURCE_DATABASE_URL=postgres://postgres:...@db.<proyecto>.supabase.co:5432/postgres \
 *   DATABASE_URL=postgres://...  \
 *   node scripts/migrate-from-supabase.mjs
 *
 * Qué hace:
 *   1. Copia auth.users → public.users conservando ids y los hashes
 *      bcrypt de GoTrue (la app los verifica y re-hashea a scrypt en
 *      el primer login de cada usuario).
 *   2. Copia las tablas de public en orden de FKs, intersectando
 *      columnas (si el destino no tiene pgvector, `embedding` se
 *      omite y la base de conocimiento queda en modo full-text).
 *   3. Desactiva los triggers de usuario durante la copia (bootstrap
 *      de cuentas, contadores, NOTIFY) y los reactiva al final.
 *
 * Qué NO hace:
 *   - Los archivos de Storage (avatares, media). Descárgalos del
 *     bucket de Supabase y colócalos en STORAGE_LOCAL_PATH/<bucket>/…
 *     (o súbelos al S3/MinIO destino) conservando las rutas.
 *
 * Idempotencia: aborta si el destino ya tiene usuarios (para no
 * mezclar datos); usa --force para saltarte el chequeo bajo tu
 * responsabilidad.
 */
import process from 'node:process';
import pg from 'pg';

// Orden compatible con las FKs del esquema.
const TABLES = [
  'accounts',
  'profiles',
  'account_invitations',
  'tags',
  'contacts',
  'contact_tags',
  'custom_fields',
  'contact_custom_values',
  'contact_notes',
  'conversations',
  'messages',
  'message_reactions',
  'whatsapp_config',
  'message_templates',
  'pipelines',
  'pipeline_stages',
  'deals',
  'broadcasts',
  'broadcast_recipients',
  'automations',
  'automation_steps',
  'automation_logs',
  'automation_pending_executions',
  'flows',
  'flow_nodes',
  'flow_runs',
  'flow_run_events',
  'member_presence',
  'api_keys',
  'notifications',
  'webhook_endpoints',
  'ai_configs',
  'ai_knowledge_documents',
  'ai_knowledge_chunks',
];

const BATCH = 500;

function client(url) {
  return new pg.Client({
    connectionString: url,
    ssl:
      url.includes('supabase.co') || process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });
}

async function columnsOf(db, schema, table) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
       AND is_generated = 'NEVER'
     ORDER BY ordinal_position`,
    [schema, table]
  );
  return rows.map((r) => r.column_name);
}

async function copyTable(source, target, table, sourceSchema = 'public') {
  const sourceCols = await columnsOf(source, sourceSchema, table);
  const targetCols = await columnsOf(target, 'public', table);
  const cols = sourceCols.filter((c) => targetCols.includes(c));
  if (cols.length === 0) {
    console.warn(`⚠ ${table}: sin columnas en común, se omite`);
    return 0;
  }
  const colList = cols.map((c) => `"${c}"`).join(', ');

  let copied = 0;
  let offset = 0;
  for (;;) {
    const { rows } = await source.query(
      `SELECT ${colList} FROM ${sourceSchema}."${table}"
       ORDER BY 1 LIMIT ${BATCH} OFFSET ${offset}`
    );
    if (rows.length === 0) break;

    const params = [];
    const tuples = rows
      .map(
        (row) =>
          `(${cols
            .map((c) => {
              params.push(row[c]);
              return `$${params.length}`;
            })
            .join(', ')})`
      )
      .join(', ');
    await target.query(
      `INSERT INTO public."${table}" (${colList}) VALUES ${tuples}
       ON CONFLICT DO NOTHING`,
      params
    );
    copied += rows.length;
    offset += BATCH;
  }
  console.log(`✓ ${table}: ${copied} filas`);
  return copied;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl) {
    console.error(
      'Define SOURCE_DATABASE_URL (Postgres de Supabase) y DATABASE_URL (destino).'
    );
    process.exit(1);
  }

  const source = client(sourceUrl);
  const target = client(targetUrl);
  await source.connect();
  await target.connect();

  const { rows: existing } = await target.query(
    'SELECT count(*)::int AS n FROM users'
  );
  if (existing[0].n > 0 && !process.argv.includes('--force')) {
    console.error(
      `El destino ya tiene ${existing[0].n} usuarios — aborto para no mezclar datos. Usa --force si sabes lo que haces.`
    );
    process.exit(1);
  }

  console.log('— Desactivando triggers de usuario en el destino…');
  const allTables = ['users', ...TABLES];
  for (const t of allTables) {
    await target.query(`ALTER TABLE public."${t}" DISABLE TRIGGER USER`);
  }

  try {
    console.log('— Copiando usuarios (auth.users → users)…');
    const { rows: users } = await source.query(
      `SELECT id, email, encrypted_password, raw_user_meta_data,
              email_confirmed_at, created_at, updated_at
       FROM auth.users WHERE deleted_at IS NULL AND email IS NOT NULL`
    );
    for (const u of users) {
      await target.query(
        `INSERT INTO users (id, email, password_hash, raw_user_meta_data,
                            email_confirmed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          u.id,
          u.email,
          u.encrypted_password || null,
          u.raw_user_meta_data ?? {},
          u.email_confirmed_at,
          u.created_at,
          u.updated_at,
        ]
      );
    }
    console.log(`✓ users: ${users.length} filas`);

    console.log('— Copiando tablas de public…');
    for (const table of TABLES) {
      await copyTable(source, target, table);
    }
  } finally {
    console.log('— Reactivando triggers…');
    for (const t of allTables) {
      await target.query(`ALTER TABLE public."${t}" ENABLE TRIGGER USER`);
    }
  }

  console.log(`
Listo. Recuerda:
  1. Archivos de Storage: copia los buckets (avatars, flow-media,
     chat-media) de Supabase al storage destino conservando rutas.
  2. Los usuarios entran con su contraseña de siempre (hash bcrypt
     heredado); se re-hashea a scrypt en su primer login.
  3. Verifica con: SELECT count(*) FROM contacts; etc.`);

  await source.end();
  await target.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
