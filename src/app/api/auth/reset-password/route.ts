import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  consumePasswordResetToken,
  createSession,
  deleteAllSessions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { getUserById, updatePassword } from '@/lib/auth/users';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    password?: string;
  } | null;
  if (!body?.token || !body.password || body.password.length < 8) {
    return NextResponse.json(
      { error: 'Token and a password of at least 8 characters are required' },
      { status: 400 }
    );
  }

  const userId = await consumePasswordResetToken(body.token);
  if (!userId) {
    return NextResponse.json(
      { error: 'Reset link is invalid or has expired' },
      { status: 400 }
    );
  }

  await updatePassword(userId, body.password);
  // Un reseteo invalida toda sesión previa y deja al usuario dentro.
  await deleteAllSessions(userId);
  const { token } = await createSession(
    userId,
    request.headers.get('user-agent')
  );
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
  return NextResponse.json({ user: await getUserById(userId) });
}
