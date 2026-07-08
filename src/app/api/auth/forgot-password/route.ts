import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { sendMail, smtpConfigured } from '@/lib/auth/mailer';
import { createPasswordResetToken } from '@/lib/auth/session';
import { findUserByEmail } from '@/lib/auth/users';

/**
 * Siempre responde 200 con el mismo cuerpo — no filtra si el email
 * existe. El enlace apunta a /reset-password?token=…; sin SMTP
 * configurado el enlace se loguea en el servidor (útil en dev y en
 * instalaciones single-admin).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
  } | null;
  const email = body?.email?.trim();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const limit = checkRateLimit(`auth-forgot:${email.toLowerCase()}`, {
    limit: 3,
    windowMs: 15 * 60_000,
  });
  if (!limit.success) return rateLimitResponse(limit);

  const user = await findUserByEmail(email);
  if (user) {
    const token = await createPasswordResetToken(user.id);
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
    const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

    if (smtpConfigured()) {
      try {
        await sendMail({
          to: user.email,
          subject: 'Restablecer tu contraseña',
          text: `Para restablecer tu contraseña abre este enlace (expira en 1 hora):\n\n${link}\n\nSi no lo pediste, ignora este correo.`,
        });
      } catch (err) {
        console.error('[auth/forgot-password] fallo el envío SMTP:', err);
      }
    } else {
      console.warn(
        `[auth/forgot-password] SMTP no configurado — enlace de reseteo para ${user.email}: ${link}`
      );
    }
  }

  return NextResponse.json({ ok: true });
}
