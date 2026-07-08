/**
 * Tipos de identidad propios (reemplazan los de @supabase/supabase-js
 * conservando la forma que consume la app).
 */
export interface User {
  id: string;
  email: string;
  /** Metadata mutable del usuario (full_name, etc.). */
  user_metadata: Record<string, unknown>;
  created_at: string;
  email_confirmed_at: string | null;
}

export interface Session {
  user: User;
}

export interface AuthError {
  message: string;
  status?: number;
}

export type AuthChangeEvent =
  'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED';

export interface AuthSubscription {
  unsubscribe: () => void;
}
