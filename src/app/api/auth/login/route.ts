import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { verifyCredentials } from '@/lib/auth/users';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  const email = body?.email?.trim();
  const password = body?.password;
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    );
  }

  const limit = checkRateLimit(`auth-login:${email.toLowerCase()}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.success) return rateLimitResponse(limit);

  const user = await verifyCredentials(email, password);
  if (!user) {
    return NextResponse.json(
      { error: 'Invalid login credentials' },
      { status: 401 }
    );
  }

  const { token } = await createSession(
    user.id,
    request.headers.get('user-agent')
  );
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
  return NextResponse.json({ user });
}
