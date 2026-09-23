import { loadConfig } from "@copyr/config";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  if (config.AUTO_MIGRATE) {
    const { runMigrations } = await import("@copyr/db/migrate");
    await runMigrations(config.DATABASE_URL);
  } else if (config.NODE_ENV === "production") {
    console.warn(
      "AUTO_MIGRATE=false: drizzle will not run on boot. " +
        "If companies.archived_at or companies.stage_id are missing, apply " +
        "packages/db/drizzle/0007_dapper_chamber.sql (full merge) or " +
        "docs/sql/hotfix-companies-pipeline-columns.sql (nullable columns + backfill), " +
        "or set AUTO_MIGRATE=true / rely on render.yaml preDeployCommand.",
    );
  }
  const app = await buildApp();

  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
  console.log(`
┌─────────────────────────────────────────────────────┐
│  VentureLabs API                                    │
│  REST      http://localhost:${config.API_PORT}/api/v1          │
│  SSE       http://localhost:${config.API_PORT}/api/v1/events   │
│  Health    http://localhost:${config.API_PORT}/health          │
│                                                     │
│  Mailpit UI http://localhost:8025  (SMTP :1025)     │
│  MinIO UI   http://localhost:9001                   │
└─────────────────────────────────────────────────────┘`);

  // Start workers AFTER listen so /health passes during deploys even if the
  // session pooler is temporarily full (old instance still draining).
  if (process.env.API_RUN_WORKERS !== "false") {
    const core = (app as unknown as { core: import("@copyr/core").Core }).core;
    const start = async () => {
      await core.startWorkers();
      console.log("Background workers running (process-email, parse-document, convert-link, run-agent, run-workflows)");
    };
    void (async () => {
      const delays = [0, 2_000, 5_000, 15_000, 30_000];
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
        try {
          await start();
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[workers] start attempt ${i + 1}/${delays.length} failed: ${msg}`);
          if (i === delays.length - 1) {
            console.error("[workers] giving up for now — API stays up; automations may run inline until restart");
          }
        }
      }
    })();
  } else {
    console.warn(
      "[warn] API_RUN_WORKERS=false — agent runs and automations will execute inline (or stall on older builds). Prefer enabling workers in production.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
