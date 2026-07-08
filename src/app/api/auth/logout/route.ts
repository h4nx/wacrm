import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  deleteAllSessions,
  deleteSession,
  getSessionUser,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const body = (await request.json().catch(() => null)) as {
    scope?: string;
  } | null;

  if (body?.scope === 'global') {
    const user = await getSessionUser(token);
    if (user) await deleteAllSessions(user.id);
  } else {
    await deleteSession(token);
  }

  cookieStore.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return NextResponse.json({ user: null });
}
