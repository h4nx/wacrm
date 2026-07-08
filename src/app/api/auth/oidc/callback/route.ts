import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import * as oidc from 'openid-client';
import { getOidcConfig, oidcEnabled, resolveOidcUser } from '@/lib/auth/oidc';
import {
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  if (!oidcEnabled()) {
    return NextResponse.json(
      { error: 'OIDC no está configurado' },
      { status: 404 }
    );
  }
  const cookieStore = await cookies();
  const verifier = cookieStore.get('wacrm-oidc-verifier')?.value;
  const expectedState = cookieStore.get('wacrm-oidc-state')?.value;
  cookieStore.delete('wacrm-oidc-verifier');
  cookieStore.delete('wacrm-oidc-state');

  const loginUrl = new URL('/login', request.nextUrl.origin);
  if (!verifier || !expectedState) {
    loginUrl.searchParams.set('error', 'sso');
    return NextResponse.redirect(loginUrl);
  }

  try {
    const config = await getOidcConfig();
    // La URL actual (con code+state) valida el intercambio; respetar
    // NEXT_PUBLIC_SITE_URL para despliegues detrás de proxy.
    const currentUrl = new URL(request.url);
    if (process.env.NEXT_PUBLIC_SITE_URL) {
      const canonical = new URL(process.env.NEXT_PUBLIC_SITE_URL);
      currentUrl.protocol = canonical.protocol;
      currentUrl.host = canonical.host;
    }
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: verifier,
      expectedState,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error('El id_token no trae subject');

    const user = await resolveOidcUser({
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    });

    const { token } = await createSession(
      user.id,
      request.headers.get('user-agent')
    );
    cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl.origin));
  } catch (err) {
    console.error('[auth/oidc/callback] fallo el intercambio OIDC:', err);
    loginUrl.searchParams.set('error', 'sso');
    return NextResponse.redirect(loginUrl);
  }
}
