import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived)
    );
  });
}

/** Parámetros scrypt (OWASP): N=2^15, r=8, p=1, 32 bytes. */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Hash bcrypt heredado de una instalación Supabase migrada con
 * scripts/migrate-from-supabase.mjs (GoTrue guarda `$2a$…`). Tras un
 * login exitoso el hash se re-escribe a scrypt (ver users.ts).
 */
export function isLegacyBcryptHash(stored: string | null): boolean {
  return Boolean(stored && /^\$2[aby]\$/.test(stored));
}

export async function verifyPassword(
  password: string,
  stored: string | null
): Promise<boolean> {
  if (!stored) return false;

  if (isLegacyBcryptHash(stored)) {
    const { compare } = await import('bcryptjs');
    return compare(password, stored);
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = (await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  })) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
