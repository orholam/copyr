import type { Database } from "./index.js";

type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

function poolOf(db: Database): Pool {
  return (db as unknown as { $client: Pool }).$client;
}

/** Copyr's deals table always has these tenant/pipeline columns. */
export function isCopyrDealsTable(columns: string[]): boolean {
  const set = new Set(columns.map((c) => c.toLowerCase()));
  return set.has("workspace_id") && set.has("pipeline_id") && set.has("stage_id");
}

export function shouldPreserveNonCopyrDeals(columns: string[]): boolean {
  return columns.length > 0 && !isCopyrDealsTable(columns);
}

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const res = await pool.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`,
    [name],
  );
  return res.rows.length > 0;
}

async function unusedTableName(pool: Pool, base: string): Promise<string> {
  let name = base;
  let n = 0;
  while (await tableExists(pool, name)) {
    n += 1;
    name = `${base}_${n}`;
  }
  return name;
}

/**
 * The venlabs-demo Supabase project shipped with a thin `public.deals` scaffold.
 * Copyr's first migration also creates `public.deals`. If the existing table is
 * not Copyr's schema, rename it (never drop) so drizzle can create the real one.
 */
export async function preserveNonCopyrDeals(db: Database): Promise<string | null> {
  const pool = poolOf(db);
  const cols = await pool.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'deals'
     order by ordinal_position`,
  );
  const names = cols.rows.map((r) => String(r.column_name));
  if (!shouldPreserveNonCopyrDeals(names)) return null;

  const dest = await unusedTableName(pool, "deals_scaffold");
  await pool.query(`alter table public.deals rename to ${quoteIdent(dest)}`);

  const constraints = await pool.query(
    `select con.conname as conname
     from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = $1`,
    [dest],
  );
  for (const row of constraints.rows) {
    const conname = String(row.conname);
    const next = renameDealsIdent(conname, dest);
    if (next !== conname) {
      await pool
        .query(
          `alter table public.${quoteIdent(dest)} rename constraint ${quoteIdent(conname)} to ${quoteIdent(next)}`,
        )
        .catch(() => undefined);
    }
  }

  const indexes = await pool.query(
    `select indexname from pg_indexes where schemaname = 'public' and tablename = $1`,
    [dest],
  );
  for (const row of indexes.rows) {
    const indexname = String(row.indexname);
    const next = renameDealsIdent(indexname, dest);
    if (next !== indexname) {
      await pool
        .query(`alter index public.${quoteIdent(indexname)} rename to ${quoteIdent(next)}`)
        .catch(() => undefined);
    }
  }

  return dest;
}

export function renameDealsIdent(name: string, destTable: string): string {
  if (name.startsWith("deals_scaffold")) return name;
  if (name.startsWith("deals_")) return name.replace(/^deals_/, `${destTable}_`);
  return `${destTable}_${name}`;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`refusing to quote unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Enable RLS on public tables with no policies. The Copyr API connects as
 * `postgres` (BYPASSRLS). Anon PostgREST access is denied — important on
 * Supabase where every public table is otherwise exposed.
 */
export async function enablePublicRls(db: Database): Promise<number> {
  const pool = poolOf(db);
  const res = await pool.query(`
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false
  `);
  let count = 0;
  for (const row of res.rows) {
    const table = String(row.tablename);
    await pool.query(`alter table public.${quoteIdent(table)} enable row level security`);
    count += 1;
  }
  return count;
}
