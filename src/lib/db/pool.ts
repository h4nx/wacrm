import { Pool, types } from 'pg';

/**
 * PostgREST serializaba a JSON: timestamps como texto ISO-8601 (con
 * microsegundos), dates como 'YYYY-MM-DD', y numeric/int8 como number.
 * node-pg por defecto devuelve Date de JS y strings — la app se
 * escribió contra el formato JSON, así que lo replicamos aquí.
 */
const OID = {
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  NUMERIC: 1700,
  INT8: 20,
};

/** '2026-07-08 07:08:00.123456-05' → '2026-07-08T07:08:00.123456-05:00' */
function pgTimestampToIso(value: string): string {
  let iso = value.replace(' ', 'T');
  const offset = iso.match(/([+-]\d{2})(?::?(\d{2}))?$/);
  if (offset) {
    iso = iso.slice(0, offset.index) + offset[1] + ':' + (offset[2] ?? '00');
  }
  return iso;
}

types.setTypeParser(OID.TIMESTAMPTZ, pgTimestampToIso);
types.setTypeParser(OID.TIMESTAMP, (v) => v.replace(' ', 'T'));
types.setTypeParser(OID.DATE, (v) => v);
types.setTypeParser(OID.NUMERIC, (v) => parseFloat(v));
types.setTypeParser(OID.INT8, (v) => parseInt(v, 10));

/**
 * Pool único de Postgres para todo el proceso. El usuario de
 * DATABASE_URL debe ser el dueño del esquema (el que corrió las
 * migraciones): las rutas de servicio consultan con sus privilegios
 * (equivalente al service-role de Supabase, RLS bypass por ownership),
 * y las consultas iniciadas por un usuario bajan a `SET LOCAL ROLE
 * convix_user` donde RLS sí aplica.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL no está definida — apunta a tu PostgreSQL (ver .env.local.example)'
      );
    }
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return pool;
}
