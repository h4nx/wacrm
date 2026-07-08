/**
 * Capa de datos portable de wacrm.
 *
 * El builder (src/lib/db/builder.ts) produce un *descriptor* JSON del
 * query — el mismo objeto se ejecuta directo contra Postgres en el
 * servidor (src/lib/db/execute.ts) o viaja por HTTP a /api/db desde el
 * navegador. La API imita el subconjunto de supabase-js/PostgREST que
 * usa la app, de modo que el código de features no cambió al salir de
 * Supabase; la autorización la sigue aplicando RLS en Postgres (rol
 * wacrm_user + GUC app.user_id — ver db/migrations/0001_init.sql).
 */

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains';

export interface ColumnFilter {
  type: 'op';
  /** Puede ser `col` o `embed.col` (filtro sobre una relación embebida). */
  column: string;
  op: FilterOp;
  value: unknown;
}

/** Expresión .or() en el DSL de PostgREST: `a.eq.1,and(b.eq.2,c.lt.3)` */
export interface OrFilter {
  type: 'or';
  expr: string;
}

export type Filter = ColumnFilter | OrFilter;

export interface OrderSpec {
  column: string;
  ascending: boolean;
}

export type QueryAction = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

export interface QueryDescriptor {
  kind: 'query';
  table: string;
  action: QueryAction;
  /** Cadena de proyección PostgREST ('*', 'a, b, alias:rel(c)'…). */
  select: string | null;
  count: 'exact' | null;
  head: boolean;
  /** Filas para insert/upsert o patch para update. */
  values: Record<string, unknown> | Record<string, unknown>[] | null;
  onConflict: string | null;
  ignoreDuplicates: boolean;
  filters: Filter[];
  order: OrderSpec[];
  limit: number | null;
  offset: number | null;
  single: 'single' | 'maybeSingle' | null;
}

export interface RpcDescriptor {
  kind: 'rpc';
  fn: string;
  args: Record<string, unknown>;
  single: 'single' | 'maybeSingle' | null;
}

export type Descriptor = QueryDescriptor | RpcDescriptor;

/** Forma de error compatible con PostgrestError. */
export interface DbError {
  message: string;
  details: string | null;
  hint: string | null;
  code: string;
}

/**
 * supabase-js sin tipos generados tipa `data` como any — la app entera
 * se escribió contra ese contrato, así que la capa portable lo replica.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DbResult<T = any> {
  data: T;
  error: DbError | null;
  count: number | null;
  status: number;
}

/** Ejecuta un descriptor y devuelve el resultado (servidor o HTTP). */
export type DescriptorExecutor = (descriptor: Descriptor) => Promise<DbResult>;
