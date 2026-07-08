/**
 * DELETE /api/storage/<bucket> — borra objetos (body: { paths: [] }).
 * Mismas reglas de ruta que la subida.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getStorage, isBucket, isSafeObjectPath } from '@/lib/storage/backend';
import { getPool } from '@/lib/db/pool';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';

interface RouteParams {
  params: Promise<{ bucket: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { bucket } = await params;
  if (!isBucket(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    paths?: string[];
  } | null;
  const paths = body?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 50) {
    return NextResponse.json(
      { error: 'paths (1–50) is required' },
      { status: 400 }
    );
  }

  let allowedPrefix: string;
  if (bucket === 'avatars') {
    allowedPrefix = `${user.id}/`;
  } else {
    const { rows } = await getPool().query(
      `SELECT account_id, account_role FROM profiles WHERE user_id = $1`,
      [user.id]
    );
    const profile = rows[0];
    const role = isAccountRole(profile?.account_role)
      ? profile.account_role
      : null;
    if (!profile || !role || !canSendMessages(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    allowedPrefix = `account-${profile.account_id}/`;
  }

  for (const p of paths) {
    if (
      typeof p !== 'string' ||
      !isSafeObjectPath(p) ||
      !p.startsWith(allowedPrefix)
    ) {
      return NextResponse.json(
        { error: `Forbidden path: ${p}` },
        { status: 403 }
      );
    }
  }

  const storage = getStorage();
  await Promise.all(paths.map((p) => storage.delete(bucket, p)));
  return NextResponse.json({ ok: true });
}
