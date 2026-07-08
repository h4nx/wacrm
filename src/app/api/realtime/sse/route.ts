import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getBroker } from '@/lib/realtime/broker';
import { getPool } from '@/lib/db/pool';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Stream SSE por usuario. El broker filtra los eventos por cuenta (y
 * por usuario para notifications) antes de escribirlos aquí.
 */
export async function GET() {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { rows } = await getPool().query(
    `SELECT account_id FROM profiles WHERE user_id = $1`,
    [user.id]
  );
  const accountId: string | undefined = rows[0]?.account_id;
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };
      const unsubscribe = getBroker().subscribe({
        userId: user.id,
        accountId,
        send,
      });
      // Comentario keep-alive para atravesar proxies/balancers.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      controller.enqueue(encoder.encode(`: connected\n\n`));
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
