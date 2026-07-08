/**
 * Ejecutor de descriptores en el servidor.
 *
 * Cada ejecución corre en una transacción. Con `userId` presente baja
 * a `SET LOCAL ROLE wacrm_user` y fija el GUC `app.user_id`, de modo
 * que las políticas RLS (idénticas a las de Supabase, con app_uid()
 * en lugar de auth.uid()) autorizan cada fila. Sin `userId` la
 * conexión conserva los privilegios del dueño del esquema — es el
 * equivalente del service-role para webhook/automatizaciones/API keys.
 */
import type { DatabaseError, PoolClient } from 'pg';
import { compileQuery, CompileError } from './compile';
import { getPool } from './pool';
import type { DbError, DbResult, Descriptor, RpcDescriptor } from './types';

export interface ExecutionContext {
  /** Usuario actuante; undefined = privilegios de servicio (sin RLS). */
  userId?: string;
}

const NO_ROWS: DbError = {
  message: 'JSON object requested, multiple (or no) rows returned',
  details: 'The result contains 0 rows',
  hint: null,
  code: 'PGRST116',
};

const MANY_ROWS: DbError = {
  ...NO_ROWS,
  details: 'The result contains multiple rows',
};

function toDbError(err: unknown): DbError {
  if (err instanceof CompileError) {
    return {
      message: err.message,
      details: null,
      hint: null,
      code: 'WACRM_COMPILE',
    };
  }
  const pg = err as Partial<DatabaseError> & { message?: string };
  return {
    message: pg.message ?? 'database error',
    details: (pg.detail as string | undefined) ?? null,
    hint: (pg.hint as string | undefined) ?? null,
    code: (pg.code as string | undefined) ?? 'WACRM_UNKNOWN',
  };
}

function applySingle(
  rows: unknown[],
  mode: 'single' | 'maybeSingle' | null
): { data: unknown; error: DbError | null } {
  if (mode === null) return { data: rows, error: null };
  if (rows.length === 1) return { data: rows[0], error: null };
  if (rows.length === 0) {
    return mode === 'maybeSingle'
      ? { data: null, error: null }
      : { data: null, error: NO_ROWS };
  }
  return { data: null, error: MANY_ROWS };
}

// ------------------------------------------------------------------
// RPC — introspección cacheada del tipo de retorno para reproducir
// la forma de respuesta de PostgREST (escalar, void, set de filas).
// ------------------------------------------------------------------

interface FnShape {
  returnsSet: boolean;
  returnsVoid: boolean;
  returnsComposite: boolean;
}

const fnShapeCache = new Map<string, FnShape>();

async function getFnShape(client: PoolClient, fn: string): Promise<FnShape> {
  const cached = fnShapeCache.get(fn);
  if (cached) return cached;
  const { rows } = await client.query(
    `SELECT p.proretset AS set,
            t.typname = 'void' AS is_void,
            t.typtype IN ('c', 'p') AS composite
     FROM pg_proc p JOIN pg_type t ON t.oid = p.prorettype
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1
     LIMIT 1`,
    [fn]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error(`function public.${fn} does not exist`), {
      code: '42883',
    });
  }
  const shape: FnShape = {
    returnsSet: rows[0].set,
    returnsVoid: rows[0].is_void,
    returnsComposite: rows[0].composite,
  };
  fnShapeCache.set(fn, shape);
  return shape;
}

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function runRpc(
  client: PoolClient,
  d: RpcDescriptor
): Promise<unknown[]> {
  if (!IDENT_RE.test(d.fn)) {
    throw Object.assign(new Error(`invalid function name`), { code: '42883' });
  }
  const shape = await getFnShape(client, d.fn);
  const names = Object.keys(d.args);
  for (const n of names) {
    if (!IDENT_RE.test(n)) {
      throw Object.assign(new Error(`invalid argument name ${n}`), {
        code: '42883',
      });
    }
  }
  const params: unknown[] = [];
  const argList = names
    .map((n) => {
      params.push(d.args[n]);
      return `"${n}" => $${params.length}`;
    })
    .join(', ');

  if (shape.returnsVoid) {
    await client.query(`SELECT "${d.fn}"(${argList})`, params);
    return [];
  }
  if (shape.returnsSet || shape.returnsComposite) {
    const { rows } = await client.query(
      `SELECT to_jsonb(x) AS row FROM "${d.fn}"(${argList}) x`,
      params
    );
    return rows.map((r) => r.row);
  }
  const { rows } = await client.query(
    `SELECT "${d.fn}"(${argList}) AS v`,
    params
  );
  return rows.map((r) => r.v);
}

// ------------------------------------------------------------------

export async function executeDescriptor(
  descriptor: Descriptor,
  ctx: ExecutionContext
): Promise<DbResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (ctx.userId) {
      await client.query('SET LOCAL ROLE wacrm_user');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [
        ctx.userId,
      ]);
    }

    let data: unknown = null;
    let error: DbError | null = null;
    let count: number | null = null;

    if (descriptor.kind === 'rpc') {
      const rows = await runRpc(client, descriptor);
      if (descriptor.single) {
        ({ data, error } = applySingle(rows, descriptor.single));
      } else {
        const shape = fnShapeCache.get(descriptor.fn);
        data = shape && !shape.returnsSet ? (rows[0] ?? null) : rows;
      }
    } else {
      const compiled = compileQuery(descriptor);
      const result = await client.query(
        compiled.text,
        compiled.values as unknown[]
      );

      if (descriptor.head && descriptor.count) {
        count = result.rows[0]?.count ?? 0;
        data = null;
      } else if (descriptor.action !== 'select' && descriptor.count) {
        // Mutación con { count: 'exact' } → filas afectadas.
        count = result.rowCount ?? 0;
        data =
          descriptor.select === null
            ? null
            : applySingle(result.rows, descriptor.single).data;
      } else {
        if (compiled.countText) {
          const countResult = await client.query(
            compiled.countText,
            compiled.countValues as unknown[]
          );
          count = countResult.rows[0]?.count ?? 0;
        }
        if (descriptor.action !== 'select' && descriptor.select === null) {
          data = null;
        } else {
          ({ data, error } = applySingle(result.rows, descriptor.single));
        }
      }
    }

    if (error) {
      await client.query('ROLLBACK');
      return { data, error, count: null, status: 406 };
    }
    await client.query('COMMIT');
    return { data, error: null, count, status: 200 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { data: null, error: toDbError(err), count: null, status: 400 };
  } finally {
    client.release();
  }
}
