/**
 * GET  /api/storage/<bucket>/<path>  — lectura pública (los buckets
 *      eran públicos también en la era Supabase; los nombres de objeto
 *      llevan timestamp y no son enumerables).
 * POST /api/storage/<bucket>/<path>  — subida autenticada. Reglas de
 *      ruta heredadas de las políticas RLS de storage:
 *        avatars:    <user_id>/...
 *        flow-media / chat-media: account-<account_id>/...  (agente+)
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  BUCKETS,
  contentTypeFor,
  etagFor,
  getStorage,
  isBucket,
  isSafeObjectPath,
} from '@/lib/storage/backend';
import { getPool } from '@/lib/db/pool';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';

interface RouteParams {
  params: Promise<{ bucket: string; path: string[] }>;
}

function resolveObject(bucket: string, segments: string[]) {
  if (!isBucket(bucket)) return null;
  const objectPath = segments.map(decodeURIComponent).join('/');
  if (!isSafeObjectPath(objectPath)) return null;
  return { bucket, objectPath };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { bucket, path } = await params;
  const target = resolveObject(bucket, path);
  if (!target) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const body = await getStorage().get(target.bucket, target.objectPath);
  if (!body) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': contentTypeFor(target.objectPath),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etagFor(body),
    },
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { bucket, path } = await params;
  const target = resolveObject(bucket, path);
  if (!target) {
    return NextResponse.json(
      { error: 'Invalid bucket or path' },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firstSegment = target.objectPath.split('/')[0];
  if (target.bucket === 'avatars') {
    if (firstSegment !== user.id) {
      return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
    }
  } else {
    const { rows } = await getPool().query(
      `SELECT account_id, account_role FROM profiles WHERE user_id = $1`,
      [user.id]
    );
    const profile = rows[0];
    const role = isAccountRole(profile?.account_role)
      ? profile.account_role
      : null;
    if (
      !profile ||
      !role ||
      !canSendMessages(role) ||
      firstSegment !== `account-${profile.account_id}`
    ) {
      return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
    }
  }

  const raw = Buffer.from(await request.arrayBuffer());
  const limit = BUCKETS[target.bucket].maxBytes;
  if (raw.byteLength === 0 || raw.byteLength > limit) {
    return NextResponse.json(
      { error: `File must be between 1 byte and ${limit} bytes` },
      { status: 413 }
    );
  }

  const contentType =
    request.headers.get('content-type') ?? contentTypeFor(target.objectPath);
  await getStorage().put(target.bucket, target.objectPath, raw, contentType);
  return NextResponse.json({ path: target.objectPath });
}
