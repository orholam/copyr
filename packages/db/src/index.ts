import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadConfig } from "@copyr/config";
import * as schema from "./schema.js";

/** Inferred first so `Database` doesn't reference itself. */
export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

let defaultDb: Database | undefined;

/** Lazily-created shared instance using DATABASE_URL. */
export function getDb(): Database {
  if (!defaultDb) defaultDb = createDb(loadConfig().DATABASE_URL);
  return defaultDb;
}

/** Test helper. */
export function setDefaultDb(db: Database): void {
  defaultDb = db;
}

export { schema };
