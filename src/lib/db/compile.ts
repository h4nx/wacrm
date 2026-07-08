/**
 * Compila un QueryDescriptor a SQL parametrizado.
 *
 * Reproduce la semántica del subconjunto de PostgREST que usa la app:
 * proyecciones con relaciones embebidas (`alias:tabla(cols)`, `!inner`),
 * filtros planos y en DSL `.or()`, y mutaciones con RETURNING. Los
 * identificadores se validan y se citan; los valores SIEMPRE viajan
 * como parámetros.
 */
import { FOREIGN_KEYS } from './fk-map';
import type { Filter, FilterOp, QueryDescriptor } from './types';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** PK compuestas o no estándar; el resto de tablas usan `id`. */
const PRIMARY_KEYS: Record<string, string[]> = {
  member_presence: ['user_id'],
};

export class CompileError extends Error {}

function ident(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new CompileError(`Identificador inválido: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * Columna calificada, con soporte de accesores JSON de PostgREST:
 * `payload->>meta_message_id` → "alias"."payload"->>'meta_message_id'.
 */
function qualifyColumn(sqlAlias: string, column: string): string {
  const json = column.match(
    /^([a-zA-Z_][a-zA-Z0-9_]*)((?:->>?[a-zA-Z0-9_]+)+)$/
  );
  if (json) {
    const accessors = json[2].replace(
      /(->>?)([a-zA-Z0-9_]+)/g,
      (_m, arrow, key) => `${arrow}'${key}'`
    );
    return `${sqlAlias}.${ident(json[1])}${accessors}`;
  }
  return `${sqlAlias}.${ident(column)}`;
}

class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

// ------------------------------------------------------------------
// Parser de proyección ('a, b, alias:rel(c, nested(d))', '*', …)
// ------------------------------------------------------------------

interface ProjectionColumn {
  kind: 'column';
  name: string;
  alias: string | null;
}

interface ProjectionEmbed {
  kind: 'embed';
  alias: string;
  table: string;
  inner: boolean;
  items: ProjectionItem[];
}

type ProjectionItem = ProjectionColumn | { kind: 'star' } | ProjectionEmbed;

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '' || parts.length === 0) parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

export function parseProjection(select: string): ProjectionItem[] {
  return splitTopLevel(select, ',').map(parseProjectionItem);
}

function parseProjectionItem(item: string): ProjectionItem {
  if (item === '*') return { kind: 'star' };

  const parenIdx = item.indexOf('(');
  if (parenIdx === -1) {
    const colonIdx = item.indexOf(':');
    if (colonIdx === -1) return { kind: 'column', name: item, alias: null };
    return {
      kind: 'column',
      name: item.slice(colonIdx + 1).trim(),
      alias: item.slice(0, colonIdx).trim(),
    };
  }

  if (!item.endsWith(')')) {
    throw new CompileError(`Proyección malformada: ${JSON.stringify(item)}`);
  }
  let head = item.slice(0, parenIdx).trim();
  const body = item.slice(parenIdx + 1, -1);

  let alias: string | null = null;
  const colonIdx = head.indexOf(':');
  if (colonIdx !== -1) {
    alias = head.slice(0, colonIdx).trim();
    head = head.slice(colonIdx + 1).trim();
  }

  let inner = false;
  if (head.endsWith('!inner')) {
    inner = true;
    head = head.slice(0, -'!inner'.length);
  } else if (head.includes('!')) {
    throw new CompileError(
      `Hint de embed no soportado (solo !inner): ${JSON.stringify(item)}`
    );
  }

  return {
    kind: 'embed',
    alias: alias ?? head,
    table: head,
    inner,
    items: parseProjection(body),
  };
}

// ------------------------------------------------------------------
// Inferencia de joins por FK
// ------------------------------------------------------------------

interface EmbedJoin {
  /** true → el embed devuelve un array (FK vive en la tabla embebida). */
  many: boolean;
  /** Columna en la tabla base. */
  baseColumn: string;
  /** Columna en la tabla embebida. */
  embedColumn: string;
}

function resolveJoin(baseTable: string, embedTable: string): EmbedJoin {
  const toEmbed = FOREIGN_KEYS.filter(
    (fk) => fk.table === baseTable && fk.refTable === embedTable
  );
  if (toEmbed.length === 1) {
    return {
      many: false,
      baseColumn: toEmbed[0].column,
      embedColumn: toEmbed[0].refColumn,
    };
  }
  const fromEmbed = FOREIGN_KEYS.filter(
    (fk) => fk.table === embedTable && fk.refTable === baseTable
  );
  if (toEmbed.length === 0 && fromEmbed.length === 1) {
    return {
      many: true,
      baseColumn: fromEmbed[0].refColumn,
      embedColumn: fromEmbed[0].column,
    };
  }
  throw new CompileError(
    `No puedo inferir la relación ${baseTable} → ${embedTable}: ` +
      `${toEmbed.length + fromEmbed.length} FKs candidatas`
  );
}

// ------------------------------------------------------------------
// Filtros
// ------------------------------------------------------------------

function compileOp(
  qualifiedColumn: string,
  op: FilterOp,
  value: unknown,
  params: Params
): string {
  switch (op) {
    case 'eq':
      if (value === null) return `${qualifiedColumn} IS NULL`;
      return `${qualifiedColumn} = ${params.add(value)}`;
    case 'neq':
      if (value === null) return `${qualifiedColumn} IS NOT NULL`;
      return `${qualifiedColumn} <> ${params.add(value)}`;
    case 'gt':
      return `${qualifiedColumn} > ${params.add(value)}`;
    case 'gte':
      return `${qualifiedColumn} >= ${params.add(value)}`;
    case 'lt':
      return `${qualifiedColumn} < ${params.add(value)}`;
    case 'lte':
      return `${qualifiedColumn} <= ${params.add(value)}`;
    case 'like':
      return `${qualifiedColumn} LIKE ${params.add(value)}`;
    case 'ilike':
      return `${qualifiedColumn} ILIKE ${params.add(value)}`;
    case 'is':
      if (value === null) return `${qualifiedColumn} IS NULL`;
      if (value === true) return `${qualifiedColumn} IS TRUE`;
      if (value === false) return `${qualifiedColumn} IS FALSE`;
      throw new CompileError(`.is() solo acepta null o boolean`);
    case 'in': {
      if (!Array.isArray(value))
        throw new CompileError('.in() requiere un array');
      return `${qualifiedColumn} = ANY(${params.add(value)})`;
    }
    case 'contains':
      return `${qualifiedColumn} @> ${params.add(value)}`;
  }
}

/**
 * DSL de `.or()`: `a.eq.1,and(b.gte.2,c.is.null)`. Comas de primer
 * nivel = OR; `and(...)`/`or(...)` anidan. El valor es todo lo que
 * sigue al segundo punto (los timestamps contienen puntos).
 */
export function compileOrExpr(
  expr: string,
  tableAlias: string,
  params: Params,
  joiner: 'OR' | 'AND' = 'OR'
): string {
  const parts = splitTopLevel(expr, ',').map((item) => {
    const nested = item.match(/^(and|or)\(([\s\S]*)\)$/);
    if (nested) {
      return compileOrExpr(
        nested[2],
        tableAlias,
        params,
        nested[1].toUpperCase() as 'OR' | 'AND'
      );
    }
    const first = item.indexOf('.');
    const second = item.indexOf('.', first + 1);
    if (first === -1 || second === -1) {
      throw new CompileError(
        `Elemento .or() malformado: ${JSON.stringify(item)}`
      );
    }
    const column = item.slice(0, first);
    const op = item.slice(first + 1, second) as FilterOp;
    let value: unknown = item.slice(second + 1);
    if (
      !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is'].includes(
        op
      )
    ) {
      throw new CompileError(`Operador .or() no soportado: ${op}`);
    }
    if (op === 'like' || op === 'ilike') {
      value = String(value).replace(/\*/g, '%');
    }
    if (op === 'is') {
      value = value === 'null' ? null : value === 'true';
    }
    return compileOp(qualifyColumn(tableAlias, column), op, value, params);
  });
  return `(${parts.join(` ${joiner} `)})`;
}

// ------------------------------------------------------------------
// SELECT con embeds
// ------------------------------------------------------------------

interface SelectContext {
  /** Nombre real de la tabla (para FKs) — puede diferir del alias SQL (CTE de mutación). */
  table: string;
  sqlAlias: string;
  params: Params;
}

function compileEmbedSubquery(
  ctx: SelectContext,
  embed: ProjectionEmbed,
  embedFilters: Map<string, Filter[]>
): string {
  const join = resolveJoin(ctx.table, embed.table);
  const alias = `e_${embed.alias}`;
  const inner: SelectContext = {
    table: embed.table,
    sqlAlias: alias,
    params: ctx.params,
  };
  const cols = compileProjectionList(inner, embed.items, embedFilters);
  const conditions = [
    `${alias}.${ident(join.embedColumn)} = ${ctx.sqlAlias}.${ident(join.baseColumn)}`,
  ];
  for (const f of embedFilters.get(embed.alias) ?? []) {
    if (f.type !== 'op') continue;
    const col = f.column.split('.').slice(1).join('.');
    conditions.push(
      compileOp(qualifyColumn(alias, col), f.op, f.value, ctx.params)
    );
  }
  const body = `SELECT ${cols} FROM ${ident(embed.table)} ${alias} WHERE ${conditions.join(' AND ')}`;
  if (join.many) {
    return `(SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (${body}) t) AS ${ident(embed.alias)}`;
  }
  return `(SELECT row_to_json(t) FROM (${body}) t) AS ${ident(embed.alias)}`;
}

function compileProjectionList(
  ctx: SelectContext,
  items: ProjectionItem[],
  embedFilters: Map<string, Filter[]>
): string {
  const parts = items.map((item) => {
    if (item.kind === 'star') return `${ctx.sqlAlias}.*`;
    if (item.kind === 'column') {
      const expr = `${ctx.sqlAlias}.${ident(item.name)}`;
      return item.alias ? `${expr} AS ${ident(item.alias)}` : expr;
    }
    return compileEmbedSubquery(ctx, item, embedFilters);
  });
  return parts.join(', ');
}

/** Separa filtros de la tabla base de los filtros `embed.columna`. */
function splitFilters(filters: Filter[]): {
  base: Filter[];
  embedFilters: Map<string, Filter[]>;
} {
  const base: Filter[] = [];
  const embedFilters = new Map<string, Filter[]>();
  for (const f of filters) {
    if (f.type === 'op' && f.column.includes('.')) {
      const prefix = f.column.split('.')[0];
      const list = embedFilters.get(prefix) ?? [];
      list.push(f);
      embedFilters.set(prefix, list);
    } else {
      base.push(f);
    }
  }
  return { base, embedFilters };
}

function compileWhere(
  ctx: SelectContext,
  base: Filter[],
  items: ProjectionItem[],
  embedFilters: Map<string, Filter[]>
): string {
  const conditions: string[] = [];
  for (const f of base) {
    if (f.type === 'or') {
      conditions.push(compileOrExpr(f.expr, ctx.sqlAlias, ctx.params));
    } else {
      conditions.push(
        compileOp(
          qualifyColumn(ctx.sqlAlias, f.column),
          f.op,
          f.value,
          ctx.params
        )
      );
    }
  }
  // Los embeds !inner filtran la fila base vía EXISTS.
  for (const item of items) {
    if (item.kind !== 'embed' || !item.inner) continue;
    const join = resolveJoin(ctx.table, item.table);
    const alias = `x_${item.alias}`;
    const inner = [
      `${alias}.${ident(join.embedColumn)} = ${ctx.sqlAlias}.${ident(join.baseColumn)}`,
    ];
    for (const f of embedFilters.get(item.alias) ?? []) {
      if (f.type !== 'op') continue;
      const col = f.column.split('.').slice(1).join('.');
      inner.push(
        compileOp(qualifyColumn(alias, col), f.op, f.value, ctx.params)
      );
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM ${ident(item.table)} ${alias} WHERE ${inner.join(' AND ')})`
    );
  }
  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
}

function compileTail(d: QueryDescriptor, ctx: SelectContext): string {
  let sql = '';
  if (d.order.length > 0) {
    const orders = d.order.map(
      (o) =>
        `${ctx.sqlAlias}.${ident(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`
    );
    sql += ` ORDER BY ${orders.join(', ')}`;
  }
  if (d.limit !== null) sql += ` LIMIT ${ctx.params.add(d.limit)}`;
  if (d.offset !== null) sql += ` OFFSET ${ctx.params.add(d.offset)}`;
  return sql;
}

// ------------------------------------------------------------------
// Mutaciones
// ------------------------------------------------------------------

function compileInsert(d: QueryDescriptor, params: Params): string {
  const rows = Array.isArray(d.values) ? d.values : [d.values!];
  if (rows.length === 0) throw new CompileError('insert sin filas');
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (columns.length === 0) throw new CompileError('insert sin columnas');

  const valuesSql = rows
    .map(
      (row) =>
        `(${columns
          .map((c) => (c in row ? params.add(row[c]) : 'DEFAULT'))
          .join(', ')})`
    )
    .join(', ');

  let sql = `INSERT INTO ${ident(d.table)} (${columns.map(ident).join(', ')}) VALUES ${valuesSql}`;

  if (d.action === 'upsert') {
    const conflictCols = d.onConflict
      ? d.onConflict.split(',').map((c) => c.trim())
      : (PRIMARY_KEYS[d.table] ?? ['id']);
    sql += ` ON CONFLICT (${conflictCols.map(ident).join(', ')})`;
    if (d.ignoreDuplicates) {
      sql += ' DO NOTHING';
    } else {
      const updatable = columns.filter((c) => !conflictCols.includes(c));
      if (updatable.length === 0) {
        sql += ' DO NOTHING';
      } else {
        sql += ` DO UPDATE SET ${updatable
          .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
          .join(', ')}`;
      }
    }
  }
  return sql;
}

function compileUpdate(d: QueryDescriptor, params: Params): string {
  const patch = d.values as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new CompileError('update sin columnas');
  const sets = keys.map((c) => `${ident(c)} = ${params.add(patch[c])}`);
  const ctx: SelectContext = {
    table: d.table,
    sqlAlias: ident(d.table),
    params,
  };
  const { base } = splitFilters(d.filters);
  return `UPDATE ${ident(d.table)} SET ${sets.join(', ')}${compileWhere(ctx, base, [], new Map())}`;
}

function compileDelete(d: QueryDescriptor, params: Params): string {
  const ctx: SelectContext = {
    table: d.table,
    sqlAlias: ident(d.table),
    params,
  };
  const { base } = splitFilters(d.filters);
  return `DELETE FROM ${ident(d.table)}${compileWhere(ctx, base, [], new Map())}`;
}

// ------------------------------------------------------------------
// Entrada principal
// ------------------------------------------------------------------

export interface CompiledQuery {
  text: string;
  values: unknown[];
  /** Query de conteo asociada (count: 'exact'). */
  countText?: string;
  countValues?: unknown[];
}

export function compileQuery(d: QueryDescriptor): CompiledQuery {
  const params = new Params();

  if (d.action === 'select') {
    const items = parseProjection(d.select ?? '*');
    const { base, embedFilters } = splitFilters(d.filters);
    const ctx: SelectContext = { table: d.table, sqlAlias: 'b', params };
    const where = compileWhere(ctx, base, items, embedFilters);
    // La query de conteo reutiliza solo los parámetros del WHERE; los de
    // la proyección (embeds) y limit/offset se agregan después.
    const whereParamCount = params.values.length;

    if (d.head && d.count) {
      return {
        text: `SELECT count(*)::int AS count FROM ${ident(d.table)} b${where}`,
        values: params.values,
      };
    }

    const cols = compileProjectionList(ctx, items, embedFilters);
    const text = `SELECT ${cols} FROM ${ident(d.table)} b${where}${compileTail(d, ctx)}`;

    if (d.count) {
      return {
        text,
        values: params.values,
        countText: `SELECT count(*)::int AS count FROM ${ident(d.table)} b${where}`,
        countValues: params.values.slice(0, whereParamCount),
      };
    }
    return { text, values: params.values };
  }

  // Mutaciones — con RETURNING (y proyección) cuando hay .select().
  let mutation: string;
  if (d.action === 'insert' || d.action === 'upsert') {
    mutation = compileInsert(d, params);
  } else if (d.action === 'update') {
    mutation = compileUpdate(d, params);
  } else {
    mutation = compileDelete(d, params);
  }

  if (d.select === null) {
    return { text: mutation, values: params.values };
  }

  const items = parseProjection(d.select);
  const ctx: SelectContext = { table: d.table, sqlAlias: 'm', params };
  const cols = compileProjectionList(ctx, items, new Map());
  const text = `WITH m AS (${mutation} RETURNING *) SELECT ${cols} FROM m${compileTail(d, ctx)}`;
  return { text, values: params.values };
}
