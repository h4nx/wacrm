/**
 * Cliente de datos del SERVIDOR — mantiene la firma histórica
 * `createClient()` pero ejecuta directo contra Postgres.
 *
 * - `createClient()`: contexto del usuario de la sesión (cookie). Cada
 *   query corre con SET LOCAL ROLE wacrm_user + GUC app.user_id, así
 *   que RLS autoriza igual que en la era Supabase.
 * - `createServiceClient()`: privilegios de servicio (dueño del
 *   esquema, sin RLS) — reemplaza al service-role key. Solo para
 *   webhook, motor de automatizaciones/flows y el auth path de la
 *   API pública.
 */
import { cookies } from 'next/headers';
import { DbClient } from '@/lib/db/builder';
import { executeDescriptor } from '@/lib/db/execute';
import type { Descriptor, DbResult } from '@/lib/db/types';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth/session';
import type { AuthError, Session, User } from '@/types/auth';

export class ServerClient extends DbClient {
  constructor(private resolveUser: () => Promise<User | null>) {
    super(async (descriptor: Descriptor): Promise<DbResult> => {
      const user = await this.resolveUser();
      if (!user) {
        return {
          data: null,
          error: {
            message: 'Unauthorized',
            details: null,
            hint: null,
            code: '401',
          },
          count: null,
          status: 401,
        };
      }
      return executeDescriptor(descriptor, { userId: user.id });
    });
    this.auth = {
      getUser: async () => {
        const user = await this.resolveUser();
        return { data: { user }, error: null };
      },
      getSession: async () => {
        const user = await this.resolveUser();
        return { data: { session: user ? { user } : null }, error: null };
      },
    };
  }

  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
      error: AuthError | null;
    }>;
    getSession: () => Promise<{
      data: { session: Session | null };
      error: AuthError | null;
    }>;
  };
}

export async function createClient(): Promise<ServerClient> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  let cached: Promise<User | null> | null = null;
  return new ServerClient(() => {
    cached ??= getSessionUser(token);
    return cached;
  });
}

/**
 * Cliente con privilegios de servicio (RLS bypass). Igual que el
 * service-role de Supabase: nunca lo uses en un camino que dependa
 * de la autorización por usuario.
 */
export class ServiceClient extends DbClient {
  constructor() {
    super((descriptor: Descriptor) => executeDescriptor(descriptor, {}));
  }
}

let serviceClient: ServiceClient | null = null;

export function createServiceClient(): ServiceClient {
  serviceClient ??= new ServiceClient();
  return serviceClient;
}
