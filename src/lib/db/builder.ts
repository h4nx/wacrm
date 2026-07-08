/**
 * Query builder isomórfico compatible con el subconjunto de
 * supabase-js que usa la app. No sabe hablar SQL: acumula un
 * QueryDescriptor y se lo entrega al executor al hacer await
 * (es thenable, igual que el builder de supabase-js).
 */
import type {
  Descriptor,
  DescriptorExecutor,
  DbResult,
  Filter,
  FilterOp,
  QueryAction,
  QueryDescriptor,
} from './types';

interface SelectOptions {
  count?: 'exact';
  head?: boolean;
}

interface OrderOptions {
  ascending?: boolean;
}

interface UpsertOptions {
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase-js sin
   tipos generados expone data como any[]/any; la app se escribió contra
   ese contrato y la capa portable lo replica. */
export class QueryBuilder<T = any[]> implements PromiseLike<DbResult<T>> {
  private d: QueryDescriptor;

  constructor(
    private executor: DescriptorExecutor,
    table: string
  ) {
    this.d = {
      kind: 'query',
      table,
      action: 'select',
      select: null,
      count: null,
      head: false,
      values: null,
      onConflict: null,
      ignoreDuplicates: false,
      filters: [],
      order: [],
      limit: null,
      offset: null,
      single: null,
    };
  }

  select(columns = '*', options: SelectOptions = {}): this {
    // Sobre una mutación, .select() pide RETURNING; la acción se conserva.
    if (this.d.action === 'select' || this.d.select === null) {
      this.d.select = columns;
    }
    if (options.count) this.d.count = options.count;
    if (options.head) this.d.head = true;
    return this;
  }

  insert(values: object | object[]): this {
    this.d.action = 'insert';
    this.d.values = values as QueryDescriptor['values'];
    return this;
  }

  upsert(values: object | object[], options: UpsertOptions = {}): this {
    this.d.action = 'upsert';
    this.d.values = values as QueryDescriptor['values'];
    this.d.onConflict = options.onConflict ?? null;
    this.d.ignoreDuplicates = options.ignoreDuplicates ?? false;
    return this;
  }

  update(values: object): this {
    this.d.action = 'update';
    this.d.values = values as QueryDescriptor['values'];
    return this;
  }

  delete(options: { count?: 'exact' } = {}): this {
    this.d.action = 'delete';
    if (options.count) this.d.count = options.count;
    return this;
  }

  /**
   * Forma explícita de PostgREST: .filter('payload->>x', 'eq', v).
   * Acepta los mismos operadores que los métodos con nombre.
   */
  filter(column: string, op: FilterOp, value: unknown): this {
    this.d.filters.push({ type: 'op', column, op, value } satisfies Filter);
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.filter(column, 'eq', value);
  }
  neq(column: string, value: unknown): this {
    return this.filter(column, 'neq', value);
  }
  gt(column: string, value: unknown): this {
    return this.filter(column, 'gt', value);
  }
  gte(column: string, value: unknown): this {
    return this.filter(column, 'gte', value);
  }
  lt(column: string, value: unknown): this {
    return this.filter(column, 'lt', value);
  }
  lte(column: string, value: unknown): this {
    return this.filter(column, 'lte', value);
  }
  like(column: string, pattern: string): this {
    return this.filter(column, 'like', pattern);
  }
  ilike(column: string, pattern: string): this {
    return this.filter(column, 'ilike', pattern);
  }
  is(column: string, value: boolean | null): this {
    return this.filter(column, 'is', value);
  }
  in(column: string, values: readonly unknown[]): this {
    return this.filter(column, 'in', values as unknown[]);
  }
  contains(column: string, value: unknown[]): this {
    return this.filter(column, 'contains', value);
  }

  match(query: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(query)) {
      this.filter(column, 'eq', value);
    }
    return this;
  }

  or(expr: string): this {
    this.d.filters.push({ type: 'or', expr });
    return this;
  }

  order(column: string, options: OrderOptions = {}): this {
    this.d.order.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.d.limit = count;
    return this;
  }

  range(from: number, to: number): this {
    this.d.offset = from;
    this.d.limit = to - from + 1;
    return this;
  }

  /** Re-tipa el resultado a fila única, como PostgrestBuilder.single(). */
  single<S = any>(): QueryBuilder<S> {
    this.d.single = 'single';
    return this as unknown as QueryBuilder<S>;
  }

  maybeSingle<S = any>(): QueryBuilder<S | null> {
    this.d.single = 'maybeSingle';
    return this as unknown as QueryBuilder<S | null>;
  }

  /** Ejecución: el builder es thenable, como en supabase-js. */
  then<TResult1 = DbResult<T>, TResult2 = never>(
    onfulfilled?:
      ((value: DbResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.executor(this.d as Descriptor).then(
      (result) =>
        onfulfilled ? onfulfilled(result as DbResult<T>) : (result as TResult1),
      onrejected
    );
  }
}

export class DbClient {
  constructor(private executor: DescriptorExecutor) {}

  from<T = any[]>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this.executor, table);
  }

  rpc<T = any>(fn: string, args: Record<string, unknown> = {}): RpcBuilder<T> {
    return new RpcBuilder<T>(this.executor, fn, args);
  }
}

export class RpcBuilder<T = any> implements PromiseLike<DbResult<T>> {
  private singleMode: 'single' | 'maybeSingle' | null = null;

  constructor(
    private executor: DescriptorExecutor,
    private fn: string,
    private args: Record<string, unknown>
  ) {}

  single(): this {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle(): this {
    this.singleMode = 'maybeSingle';
    return this;
  }

  then<TResult1 = DbResult<T>, TResult2 = never>(
    onfulfilled?:
      ((value: DbResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.executor({
      kind: 'rpc',
      fn: this.fn,
      args: this.args,
      single: this.singleMode,
    }).then(
      (result) =>
        onfulfilled ? onfulfilled(result as DbResult<T>) : (result as TResult1),
      onrejected
    );
  }
}

export type { QueryAction };
