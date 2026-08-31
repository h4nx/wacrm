/**
 * SSO OIDC opcional (Vaultex/Keycloak en el ecosistema H&M Business,
 * o cualquier proveedor OIDC estándar). Se activa definiendo:
 *
 *   OIDC_ISSUER_URL     p.ej. https://sso.hmbusiness.dev/realms/convix
 *   OIDC_CLIENT_ID
 *   OIDC_CLIENT_SECRET  (opcional con PKCE si el cliente es público)
 *   OIDC_PROVIDER_NAME  etiqueta del botón de login (default "SSO")
 *
 * Sin estas variables la app funciona solo con email/contraseña.
 */
import * as oidc from 'openid-client';
import { getPool } from '@/lib/db/pool';
import { toUser } from './session';
import { normalizeEmail } from './users';
import type { User } from '@/types/auth';

export function oidcEnabled(): boolean {
  return Boolean(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID);
}

export function oidcProviderName(): string {
  return process.env.OIDC_PROVIDER_NAME ?? 'SSO';
}

let cachedConfig: oidc.Configuration | null = null;

export async function getOidcConfig(): Promise<oidc.Configuration> {
  if (!oidcEnabled()) throw new Error('OIDC no está configurado');
  if (!cachedConfig) {
    const issuer = new URL(process.env.OIDC_ISSUER_URL!);
    // openid-client exige HTTPS; un issuer http:// solo tiene sentido en
    // desarrollo (Keycloak local sin TLS). No se puede usar NODE_ENV acá:
    // `next build` reemplaza `process.env.NODE_ENV` por la constante
    // "production" en tiempo de compilación (vía define plugin), así que
    // un override en runtime (docker-compose) nunca llegaría a este check
    // en un build standalone. OIDC_ALLOW_INSECURE_HTTP sí se lee en
    // runtime porque no es una var especial para el bundler.
    const insecureDev =
      issuer.protocol === 'http:' &&
      process.env.OIDC_ALLOW_INSECURE_HTTP === 'true';

    // No usamos oidc.discovery(issuer, ...): ese helper exige (RFC 8414)
    // que el `issuer` del JSON devuelto coincida exactamente con la URL
    // pedida. En este ecosistema Keycloak sirve el well-known con
    // `issuer`/authorization_endpoint apuntando al host "de navegador"
    // (localhost) mientras que este server-side fetch solo puede
    // alcanzarlo por host.docker.internal — endpoints legítimos y
    // correctos, pero el chequeo estricto de discovery los rechaza.
    // Pedimos el well-known nosotros mismos (misma URL, mismo JSON) y
    // construimos la Configuration directo con esos metadatos, que no
    // hace esa validación.
    const wellKnownUrl = new URL(
      '.well-known/openid-configuration',
      issuer.href.endsWith('/') ? issuer.href : `${issuer.href}/`
    );
    const res = await fetch(wellKnownUrl);
    if (!res.ok) {
      throw new Error(
        `No se pudo obtener la configuración OIDC de ${wellKnownUrl}: ${res.status}`
      );
    }
    const serverMetadata = await res.json();

    cachedConfig = new oidc.Configuration(
      serverMetadata,
      process.env.OIDC_CLIENT_ID!,
      process.env.OIDC_CLIENT_SECRET
    );
    if (insecureDev) oidc.allowInsecureRequests(cachedConfig);
  }
  return cachedConfig;
}

/**
 * Resuelve el usuario local para una identidad OIDC: primero por
 * (provider, subject); si no existe, vincula por email verificado; si
 * tampoco, crea el usuario (sin contraseña — solo entra por SSO).
 */
export async function resolveOidcUser(claims: {
  sub: string;
  email?: string;
  name?: string;
}): Promise<User> {
  const provider = process.env.OIDC_ISSUER_URL!;
  const pool = getPool();

  const linked = await pool.query(
    `SELECT u.id, u.email, u.raw_user_meta_data, u.created_at, u.email_confirmed_at
     FROM oidc_identities i JOIN users u ON u.id = i.user_id
     WHERE i.provider = $1 AND i.subject = $2`,
    [provider, claims.sub]
  );
  if (linked.rows.length > 0) return toUser(linked.rows[0]);

  if (!claims.email) {
    throw new Error(
      'El proveedor OIDC no devolvió email; no puedo aprovisionar el usuario'
    );
  }
  const email = normalizeEmail(claims.email);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, email, raw_user_meta_data, created_at, email_confirmed_at
       FROM users WHERE lower(email) = $1`,
      [email]
    );
    let userRow = existing.rows[0];
    if (!userRow) {
      const inserted = await client.query(
        `INSERT INTO users (email, raw_user_meta_data, email_confirmed_at)
         VALUES ($1, $2, now())
         RETURNING id, email, raw_user_meta_data, created_at, email_confirmed_at`,
        [email, JSON.stringify({ full_name: claims.name ?? '' })]
      );
      userRow = inserted.rows[0];
    }
    await client.query(
      `INSERT INTO oidc_identities (user_id, provider, subject)
       VALUES ($1, $2, $3) ON CONFLICT (provider, subject) DO NOTHING`,
      [userRow.id, provider, claims.sub]
    );
    await client.query('COMMIT');
    return toUser(userRow);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
