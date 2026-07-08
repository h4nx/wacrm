import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';
import {
  findUserByEmail,
  getUserById,
  updateEmail,
  updatePassword,
  updateUserMetadata,
} from '@/lib/auth/users';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    data?: Record<string, unknown>;
  } | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }
    await updatePassword(user.id, body.password);
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }
    const existing = await findUserByEmail(email);
    if (existing && existing.id !== user.id) {
      return NextResponse.json(
        { error: 'Email already in use' },
        { status: 422 }
      );
    }
    await updateEmail(user.id, email);
  }

  if (body.data && typeof body.data === 'object') {
    await updateUserMetadata(user.id, body.data);
  }

  return NextResponse.json({ user: await getUserById(user.id) });
}
