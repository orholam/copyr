import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadConfig } from "@copyr/config";
import * as schema from "./schema.js";
import { pgSsl, queryDatabaseUrl } from "./connection.js";

/** Inferred first so `Database` doesn't reference itself. */
export function createDb(url: string) {
  const cfg = loadConfig();
  const pool = new pg.Pool({
    connectionString: url,
    max: cfg.DATABASE_POOL_MAX,
    ssl: pgSsl(url, cfg.DATABASE_SSL),
  });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

let defaultDb: Database | undefined;

/** Lazily-created shared instance using DATABASE_POOL_URL (or DATABASE_URL). */
export function getDb(): Database {
  if (!defaultDb) defaultDb = createDb(queryDatabaseUrl(loadConfig()));
  return defaultDb;
}

/** Test helper. */
export function setDefaultDb(db: Database): void {
  defaultDb = db;
}

export { schema };
export { pgSsl, queryDatabaseUrl } from "./connection.js";
