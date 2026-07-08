import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';

export async function GET() {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  return NextResponse.json(
    { user },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
