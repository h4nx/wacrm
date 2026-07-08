#!/usr/bin/env node
/**
 * Runner de migraciones portable (reemplaza `supabase db push`).
 *
 *   npm run db:migrate
 *
 * Aplica db/migrations/*.sql en orden lexicográfico contra
 * DATABASE_URL, registrando lo aplicado en la tabla _migrations.
 * Los archivos *.optional.sql (p.ej. pgvector para búsqueda
 * semántica) se intentan y, si la base no los soporta, se omiten
 * con un aviso y se reintentan en la próxima corrida.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL no está definida (ver .env.local.example)');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ok = 0;
  let skipped = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const optional = file.endsWith('.optional.sql');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
      ok++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (optional) {
        console.warn(
          `⚠ ${file} omitida (se reintenta en la próxima corrida): ${err.message}`
        );
        skipped++;
      } else {
        console.error(`✗ ${file} falló:\n${err.message}`);
        await client.end();
        process.exit(1);
      }
    }
  }

  console.log(
    `Migraciones: ${ok} aplicadas, ${skipped} opcionales omitidas, ${applied.size} ya estaban.`
  );
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
