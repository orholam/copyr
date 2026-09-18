import { loadConfig } from "@copyr/config";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  if (config.AUTO_MIGRATE) {
    const { runMigrations } = await import("@copyr/db/migrate");
    await runMigrations(config.DATABASE_URL);
  }
  const app = await buildApp();

  // start background workers unless this instance is API-only
  if (process.env.API_RUN_WORKERS !== "false") {
    const core = (app as unknown as { core: import("@copyr/core").Core }).core;
    await core.startWorkers();
    console.log("Background workers running (process-email, parse-document, convert-link)");
  }

  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
  console.log(`
┌─────────────────────────────────────────────────────┐
│  Copyr API                                          │
│  REST      http://localhost:${config.API_PORT}/api/v1          │
│  SSE       http://localhost:${config.API_PORT}/api/v1/events   │
│  Health    http://localhost:${config.API_PORT}/health          │
│                                                     │
│  Mailpit UI http://localhost:8025  (SMTP :1025)     │
│  MinIO UI   http://localhost:9001                   │
└─────────────────────────────────────────────────────┘`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
