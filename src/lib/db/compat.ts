/**
 * Tipos de compatibilidad con la era Supabase.
 *
 * El código de features anotaba clientes como `SupabaseClient`; tras
 * la migración a la capa portable ese nombre se conserva como interfaz
 * estructural mínima (from/rpc) que satisfacen ServerClient,
 * ServiceClient y BrowserClient. Los imports se redirigieron de
 * '@supabase/supabase-js' a este módulo.
 */
import type { QueryBuilder, RpcBuilder } from './builder';

/* eslint-disable @typescript-eslint/no-explicit-any -- contrato de
   supabase-js sin tipos generados (data: any[]/any). */
export interface SupabaseClient {
  from<T = any[]>(table: string): QueryBuilder<T>;
  rpc<T = any>(fn: string, args?: Record<string, unknown>): RpcBuilder<T>;
}

export type { User, Session, AuthError, AuthChangeEvent } from '@/types/auth';
export type { RealtimeChannel } from '@/lib/realtime/client';
export type { DbError as PostgrestError } from './types';
