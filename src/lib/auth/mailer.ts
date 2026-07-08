/**
 * Envío de correos transaccionales (hoy: reseteo de contraseña).
 *
 * SMTP configurable por env — en el ecosistema H&M el dev usa Mailpit
 * (localhost:1025) y producción el relay corporativo. Sin SMTP_HOST
 * configurado no se envía nada: el caller decide el fallback (en dev
 * se loguea el enlace en el server).
 */
import nodemailer from 'nodemailer';

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error('SMTP no configurado (SMTP_HOST)');
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? 'wacrm <no-reply@localhost>',
    ...options,
  });
}
