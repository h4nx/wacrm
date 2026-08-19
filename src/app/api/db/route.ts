/**
 * Transporte HTTP de la capa de datos para componentes cliente.
 *
 * El navegador manda un QueryDescriptor; aquí se ejecuta SIEMPRE con
 * el contexto del usuario de la sesión (SET LOCAL ROLE convix_user +
 * GUC app.user_id), así que RLS autoriza cada fila igual que cuando
 * el navegador hablaba con PostgREST usando el anon key de Supabase.
 * Los RPC expuestos al navegador pasan por allowlist.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { executeDescriptor } from '@/lib/db/execute';
import type { Descriptor } from '@/lib/db/types';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';

const CLIENT_RPC_ALLOWLIST = new Set([
  'touch_presence',
  'filter_contacts_by_tags',
]);

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json(
      {
        data: null,
        error: {
          message: 'Unauthorized',
          code: '401',
          details: null,
          hint: null,
        },
        count: null,
      },
      { status: 401 }
    );
  }

  let descriptor: Descriptor;
  try {
    descriptor = (await request.json()) as Descriptor;
  } catch {
    return NextResponse.json(
      {
        data: null,
        error: {
          message: 'Invalid JSON body',
          code: '400',
          details: null,
          hint: null,
        },
        count: null,
      },
      { status: 400 }
    );
  }

  if (descriptor.kind === 'rpc' && !CLIENT_RPC_ALLOWLIST.has(descriptor.fn)) {
    return NextResponse.json(
      {
        data: null,
        error: {
          message: `RPC ${descriptor.fn} no está disponible desde el navegador`,
          code: '42501',
          details: null,
          hint: null,
        },
        count: null,
      },
      { status: 403 }
    );
  }

  const result = await executeDescriptor(descriptor, { userId: user.id });
  // El status HTTP siempre es 200; el error viaja en el cuerpo con la
  // misma forma { data, error, count } que espera el builder.
  return NextResponse.json(result);
}
