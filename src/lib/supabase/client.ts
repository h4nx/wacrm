/**
 * Cliente de datos del NAVEGADOR — mantiene la firma histórica
 * `createClient()` (de la era Supabase) pero ya no habla con Supabase:
 *
 *  - .from()/.rpc()  → POST /api/db (RLS en Postgres vía convix_user)
 *  - .auth           → /api/auth/* (sesiones propias en cookie httpOnly)
 *  - .channel()      → SSE /api/realtime/sse (LISTEN/NOTIFY)
 *  - .storage        → /api/storage/* (S3/MinIO o disco local)
 */
import { DbClient, QueryBuilder, RpcBuilder } from '@/lib/db/builder';
import type { DbResult, Descriptor } from '@/lib/db/types';
import { realtimeManager, RealtimeChannel } from '@/lib/realtime/client';
import type {
  AuthChangeEvent,
  AuthError,
  AuthSubscription,
  Session,
  User,
} from '@/types/auth';

// ------------------------------------------------------------------
// Ejecutor HTTP de descriptores
// ------------------------------------------------------------------

async function httpExecutor(descriptor: Descriptor): Promise<DbResult> {
  let response: Response;
  try {
    response = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(descriptor),
    });
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : 'network error',
        details: null,
        hint: null,
        code: 'CONVIX_FETCH',
      },
      count: null,
      status: 0,
    };
  }
  try {
    return (await response.json()) as DbResult;
  } catch {
    return {
      data: null,
      error: {
        message: `Respuesta inválida de /api/db (HTTP ${response.status})`,
        details: null,
        hint: null,
        code: 'CONVIX_FETCH',
      },
      count: null,
      status: response.status,
    };
  }
}

// ------------------------------------------------------------------
// Auth del navegador
// ------------------------------------------------------------------

type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void;

const authListeners = new Set<AuthCallback>();

function emitAuthChange(event: AuthChangeEvent, session: Session | null) {
  for (const listener of authListeners) listener(event, session);
}

async function authRequest(
  path: string,
  body?: Record<string, unknown>
): Promise<{ user: User | null; error: AuthError | null }> {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await response.json().catch(() => ({}))) as {
      user?: User | null;
      error?: string;
    };
    if (!response.ok) {
      return {
        user: null,
        error: {
          message: json.error ?? `HTTP ${response.status}`,
          status: response.status,
        },
      };
    }
    return { user: json.user ?? null, error: null };
  } catch (err) {
    return {
      user: null,
      error: { message: err instanceof Error ? err.message : 'network error' },
    };
  }
}

const browserAuth = {
  async getUser(): Promise<{
    data: { user: User | null };
    error: AuthError | null;
  }> {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const json = (await response.json()) as { user: User | null };
      return { data: { user: json.user }, error: null };
    } catch (err) {
      return {
        data: { user: null },
        error: {
          message: err instanceof Error ? err.message : 'network error',
        },
      };
    }
  },

  async getSession(): Promise<{
    data: { session: Session | null };
    error: AuthError | null;
  }> {
    const { data, error } = await browserAuth.getUser();
    return {
      data: { session: data.user ? { user: data.user } : null },
      error,
    };
  },

  async signInWithPassword(credentials: { email: string; password: string }) {
    const { user, error } = await authRequest('login', credentials);
    const session = user ? { user } : null;
    if (user) emitAuthChange('SIGNED_IN', session);
    return { data: { user, session }, error };
  },

  async signUp(credentials: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
  }) {
    const { user, error } = await authRequest('signup', {
      email: credentials.email,
      password: credentials.password,
      data: credentials.options?.data ?? {},
    });
    const session = user ? { user } : null;
    if (user) emitAuthChange('SIGNED_IN', session);
    return { data: { user, session }, error };
  },

  async signOut(options?: { scope?: 'global' | 'local' }) {
    const { error } = await authRequest('logout', {
      scope: options?.scope ?? 'local',
    });
    emitAuthChange('SIGNED_OUT', null);
    return { error };
  },

  async updateUser(attributes: {
    email?: string;
    password?: string;
    data?: Record<string, unknown>;
  }) {
    const { user, error } = await authRequest('update-user', attributes);
    if (user) emitAuthChange('USER_UPDATED', { user });
    return { data: { user }, error };
  },

  // El segundo argumento (redirectTo) era de Supabase; el enlace de
  // reseteo ahora siempre apunta a /reset-password del propio origen.
  async resetPasswordForEmail(
    email: string,
    options?: { redirectTo?: string }
  ) {
    void options;
    const { error } = await authRequest('forgot-password', { email });
    return { data: {}, error };
  },

  onAuthStateChange(callback: AuthCallback): {
    data: { subscription: AuthSubscription };
  } {
    authListeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => authListeners.delete(callback),
        },
      },
    };
  },
};

// ------------------------------------------------------------------
// Storage del navegador
// ------------------------------------------------------------------

const browserStorage = {
  from(bucket: string) {
    return {
      async upload(
        path: string,
        file: File | Blob,
        options?: {
          upsert?: boolean;
          contentType?: string;
          cacheControl?: string;
        }
      ) {
        try {
          const response = await fetch(
            `/api/storage/${encodeURIComponent(bucket)}/${path
              .split('/')
              .map(encodeURIComponent)
              .join('/')}${options?.upsert ? '?upsert=true' : ''}`,
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  options?.contentType ||
                  (file instanceof File ? file.type : '') ||
                  'application/octet-stream',
              },
              body: file,
            }
          );
          const json = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!response.ok) {
            return {
              data: null,
              error: { message: json.error ?? `HTTP ${response.status}` },
            };
          }
          return { data: { path }, error: null };
        } catch (err) {
          return {
            data: null,
            error: {
              message: err instanceof Error ? err.message : 'network error',
            },
          };
        }
      },

      getPublicUrl(path: string): { data: { publicUrl: string } } {
        return {
          data: {
            publicUrl: `/api/storage/${encodeURIComponent(bucket)}/${path
              .split('/')
              .map(encodeURIComponent)
              .join('/')}`,
          },
        };
      },

      async remove(paths: string[]) {
        try {
          const response = await fetch(
            `/api/storage/${encodeURIComponent(bucket)}`,
            {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paths }),
            }
          );
          if (!response.ok) {
            const json = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            return {
              data: null,
              error: { message: json.error ?? `HTTP ${response.status}` },
            };
          }
          return { data: paths.map((p) => ({ name: p })), error: null };
        } catch (err) {
          return {
            data: null,
            error: {
              message: err instanceof Error ? err.message : 'network error',
            },
          };
        }
      },
    };
  },
};

// ------------------------------------------------------------------
// Cliente compuesto
// ------------------------------------------------------------------

export class BrowserClient extends DbClient {
  auth = browserAuth;
  storage = browserStorage;

  constructor() {
    super(httpExecutor);
  }

  channel(name: string): RealtimeChannel {
    return realtimeManager.channel(name);
  }

  removeChannel(channel: RealtimeChannel): Promise<'ok'> {
    return realtimeManager.removeChannel(channel);
  }
}

let browserClient: BrowserClient | undefined;

export function createClient(): BrowserClient {
  if (!browserClient) browserClient = new BrowserClient();
  return browserClient;
}

export type { QueryBuilder, RpcBuilder };
