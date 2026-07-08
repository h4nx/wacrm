/**
 * Sesiones propias sobre la tabla `sessions` (reemplazan Supabase
 * Auth). Token opaco de 256 bits en cookie httpOnly; en la base solo
 * vive su SHA-256. Expiración deslizante: cada uso más viejo que
 * TOUCH_INTERVAL_MS renueva expires_at.
 */
// Módulo exclusivo de servidor: node:crypto y pg fallan en el bundle
// de cliente (misma convención que src/lib/auth/account.ts — el repo
// no usa el paquete `server-only`).
import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '@/lib/db/pool';
import type { User } from '@/types/auth';

export { SESSION_COOKIE } from './constants';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // renovar 1×/día

export function sessionCookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds ?? SESSION_TTL_MS / 1000,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface UserRow {
  id: string;
  email: string;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string | Date;
  email_confirmed_at: string | Date | null;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    user_metadata: row.raw_user_meta_data ?? {},
    created_at: new Date(row.created_at).toISOString(),
    email_confirmed_at: row.email_confirmed_at
      ? new Date(row.email_confirmed_at).toISOString()
      : null,
  };
}

export async function createSession(
  userId: string,
  userAgent?: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), expiresAt, userAgent ?? null]
  );
  return { token, expiresAt };
}

export async function getSessionUser(
  token: string | undefined
): Promise<User | null> {
  if (!token) return null;
  const { rows } = await getPool().query(
    `SELECT s.id AS session_id, s.last_used_at,
            u.id, u.email, u.raw_user_meta_data, u.created_at, u.email_confirmed_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  const lastUsed = new Date(row.last_used_at).getTime();
  if (Date.now() - lastUsed > TOUCH_INTERVAL_MS) {
    // Renovación deslizante, fuera del camino crítico.
    getPool()
      .query(
        `UPDATE sessions SET last_used_at = now(), expires_at = $2 WHERE id = $1`,
        [row.session_id, new Date(Date.now() + SESSION_TTL_MS)]
      )
      .catch(() => {});
  }
  return toUser(row);
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getPool().query(`DELETE FROM sessions WHERE token_hash = $1`, [
    hashToken(token),
  ]);
}

export async function deleteAllSessions(userId: string): Promise<void> {
  await getPool().query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

// ------------------------------------------------------------------
// Tokens de reseteo de contraseña
// ------------------------------------------------------------------

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

export async function createPasswordResetToken(
  userId: string
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await getPool().query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), new Date(Date.now() + RESET_TTL_MS)]
  );
  return token;
}

/** Consume el token (un solo uso) y devuelve el user_id, o null. */
export async function consumePasswordResetToken(
  token: string
): Promise<string | null> {
  const { rows } = await getPool().query(
    `UPDATE password_reset_tokens
     SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [hashToken(token)]
  );
  return rows[0]?.user_id ?? null;
}
