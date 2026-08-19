import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import * as oidc from 'openid-client';
import { getOidcConfig, oidcEnabled } from '@/lib/auth/oidc';

export async function GET(request: NextRequest) {
  if (!oidcEnabled()) {
    return NextResponse.json(
      { error: 'OIDC no está configurado' },
      { status: 404 }
    );
  }
  const config = await getOidcConfig();

  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/oidc/callback`;

  const authUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  const cookieStore = await cookies();
  const flowCookie = {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  };
  cookieStore.set('convix-oidc-verifier', codeVerifier, flowCookie);
  cookieStore.set('convix-oidc-state', state, flowCookie);

  return NextResponse.redirect(authUrl);
}
