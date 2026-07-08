import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Relay de mensajes broadcast (p.ej. typing indicators): viaja por
 * pg_notify para llegar a los SSE de TODAS las instancias de la app,
 * siempre acotado a la cuenta del emisor.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    channel?: string;
    event?: string;
    payload?: unknown;
  } | null;
  if (!body?.channel || !body.event) {
    return NextResponse.json(
      { error: 'channel and event are required' },
      { status: 400 }
    );
  }

  const { rows } = await getPool().query(
    `SELECT account_id FROM profiles WHERE user_id = $1`,
    [user.id]
  );
  const accountId: string | undefined = rows[0]?.account_id;
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 403 });
  }

  const message = JSON.stringify({
    channel: body.channel,
    event: body.event,
    payload: body.payload ?? null,
    account_id: accountId,
  });
  if (Buffer.byteLength(message) > 7500) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  await getPool().query(`SELECT pg_notify('wacrm_broadcast', $1)`, [message]);
  return NextResponse.json({ ok: true });
}
