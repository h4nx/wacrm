/**
 * Repositorio de usuarios (tabla `users` propia). Módulo exclusivo de
 * servidor. La creación dispara en la base el trigger on_user_created
 * (bootstrap de cuenta + perfil, heredado de la era Supabase).
 */
import { getPool } from '@/lib/db/pool';
import { hashPassword, isLegacyBcryptHash, verifyPassword } from './passwords';
import { toUser } from './session';
import type { User } from '@/types/auth';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(
  email: string
): Promise<(User & { password_hash: string | null }) | null> {
  const { rows } = await getPool().query(
    `SELECT id, email, raw_user_meta_data, created_at, email_confirmed_at, password_hash
     FROM users WHERE lower(email) = $1`,
    [normalizeEmail(email)]
  );
  if (rows.length === 0) return null;
  return { ...toUser(rows[0]), password_hash: rows[0].password_hash };
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Igualar el costo del camino "usuario no existe" para no filtrar
    // existencia de cuentas por timing.
    await verifyPassword(password, 'scrypt$32768$8$1$AAAA$AAAA');
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  // Hash bcrypt heredado de una migración desde Supabase: ya que la
  // contraseña verificó, re-escribirla a scrypt (upgrade progresivo).
  if (isLegacyBcryptHash(user.password_hash)) {
    updatePassword(user.id, password).catch((err) =>
      console.error('[auth] fallo el re-hash a scrypt (se ignora):', err)
    );
  }

  return {
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata,
    created_at: user.created_at,
    email_confirmed_at: user.email_confirmed_at,
  };
}

export async function createUser(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const { rows } = await getPool().query(
    `INSERT INTO users (email, password_hash, raw_user_meta_data, email_confirmed_at)
     VALUES ($1, $2, $3, now())
     RETURNING id, email, raw_user_meta_data, created_at, email_confirmed_at`,
    [
      normalizeEmail(input.email),
      passwordHash,
      JSON.stringify({ full_name: input.fullName ?? '' }),
    ]
  );
  return toUser(rows[0]);
}

export async function updatePassword(
  userId: string,
  password: string
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await getPool().query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [userId, passwordHash]
  );
}

export async function updateEmail(
  userId: string,
  email: string
): Promise<void> {
  // Mantener profiles.email en sincronía (el trigger original de
  // Supabase solo copiaba en el signup).
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET email = $2, updated_at = now() WHERE id = $1`,
      [userId, normalizeEmail(email)]
    );
    await client.query(`UPDATE profiles SET email = $2 WHERE user_id = $1`, [
      userId,
      normalizeEmail(email),
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateUserMetadata(
  userId: string,
  data: Record<string, unknown>
): Promise<User> {
  const { rows } = await getPool().query(
    `UPDATE users
     SET raw_user_meta_data = raw_user_meta_data || $2::jsonb, updated_at = now()
     WHERE id = $1
     RETURNING id, email, raw_user_meta_data, created_at, email_confirmed_at`,
    [userId, JSON.stringify(data)]
  );
  return toUser(rows[0]);
}

export async function getUserById(userId: string): Promise<User | null> {
  const { rows } = await getPool().query(
    `SELECT id, email, raw_user_meta_data, created_at, email_confirmed_at
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows.length > 0 ? toUser(rows[0]) : null;
}
