import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@copyr/config";
import { createDb } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  const migrationsFolder = path.resolve(__dirname, "../../drizzle");
  console.log(`Running migrations from ${migrationsFolder} …`);
  await db.execute(`select 1`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");
  const pool = (db as unknown as { $client: { end(): Promise<void> } }).$client;
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
