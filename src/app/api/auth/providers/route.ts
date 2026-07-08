import { NextResponse } from 'next/server';
import { oidcEnabled, oidcProviderName } from '@/lib/auth/oidc';
import { smtpConfigured } from '@/lib/auth/mailer';

/** Qué métodos de login mostrar (la página de login lo consulta). */
export async function GET() {
  return NextResponse.json({
    oidc: oidcEnabled() ? { name: oidcProviderName() } : null,
    passwordReset: smtpConfigured() ? 'email' : 'admin',
  });
}
