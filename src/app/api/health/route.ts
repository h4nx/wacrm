import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';

/**
 * Liveness/readiness probe for orchestrators (Docker HEALTHCHECK,
 * Kubernetes, Coolify, etc). No auth, no session — just "is this
 * instance able to serve traffic and reach Postgres".
 */
export async function GET() {
  try {
    await getPool().query('SELECT 1');
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
}
