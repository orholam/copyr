import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@copyr/config";
import { createDb } from "./index.js";
import { enablePublicRls, preserveNonCopyrDeals } from "./prepare-target.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl?: string): Promise<void> {
  const config = loadConfig();
  const db = createDb(databaseUrl ?? config.DATABASE_URL);
  const migrationsFolder = path.resolve(__dirname, "../drizzle");
  console.log(`Running migrations from ${migrationsFolder} …`);
  await db.execute(`select 1`);

  const renamed = await preserveNonCopyrDeals(db);
  if (renamed) {
    console.log(`Preserved existing non-Copyr public.deals as public.${renamed} (not dropped).`);
  }

  await migrate(db, { migrationsFolder });
  const rls = await enablePublicRls(db);
  if (rls > 0) {
    console.log(`Enabled row level security on ${rls} public table(s) (no anon policies; API uses postgres).`);
  }
  console.log("Migrations complete.");
  const pool = (db as unknown as { $client: { end(): Promise<void> } }).$client;
  await pool.end();
}
