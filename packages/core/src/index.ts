import { loadConfig } from "@copyr/config";
import { createDb, pgSsl, queryDatabaseUrl, type Database } from "@copyr/db";
import { ObjectStore } from "@copyr/storage";
import { getAiProvider } from "@copyr/ai";
import PgBoss from "pg-boss";

import { createCoreContext, type CoreContext } from "./context.js";
import * as fieldsSvc from "./services/fields.js";
import * as pipelinesSvc from "./services/pipelines.js";
import * as companiesSvc from "./services/companies.js";
import * as dealsSvc from "./services/deals.js";
import * as documentsSvc from "./services/documents.js";
import * as emailsSvc from "./services/emails.js";
import * as contentSvc from "./services/content.js";
import * as analyticsSvc from "./services/analytics.js";
import * as sharingSvc from "./services/sharing.js";
import * as workspaceSvc from "./services/workspace.js";
import * as intelligenceSvc from "./services/intelligence.js";
import * as automationSvc from "./services/automation.js";
import * as outboundSvc from "./services/outbound.js";
import * as vaultsSvc from "./services/vaults.js";
import * as agentsSvc from "./services/agents.js";
import * as spacesSvc from "./services/spaces.js";
import * as memorySvc from "./services/memory.js";
import * as researchSvc from "./services/research.js";
import * as commandCenterSvc from "./services/commandcenter.js";
import * as automationsSvc from "./services/automations.js";
import * as assistantSvc from "./services/assistant.js";
import { startWorkers } from "./jobs/index.js";

export interface Core {
  ctx: CoreContext;
  db: Database;
  /** True when this process constructed a pg-boss client (may still be starting). */
  workersEnabled: boolean;
  /** True after startWorkers() has registered queues and handlers. */
  workersStarted: boolean;
  /** begin accepting jobs (call once per process) */
  startWorkers(): Promise<void>;
  close(): Promise<void>;

  session: typeof workspaceSvc;
  fields: typeof fieldsSvc;
  pipelines: typeof pipelinesSvc;
  companies: typeof companiesSvc;
  deals: typeof dealsSvc;
  documents: typeof documentsSvc;
  emails: typeof emailsSvc;
  content: typeof contentSvc;
  analytics: typeof analyticsSvc;
  sharing: typeof sharingSvc;
  intelligence: typeof intelligenceSvc;
  automation: typeof automationSvc;
  outbound: typeof outboundSvc;
  /** diligence vaults + review tables */
  vaults: typeof vaultsSvc;
  /** codified fund agents (Thesis Builder) + runs */
  agents: typeof agentsSvc;
  /** deal spaces + tasks routed between people and agents */
  spaces: typeof spacesSvc;
  /** fund/partner memory */
  memory: typeof memorySvc;
  /** grounded research with citations */
  research: typeof researchSvc;
  /** deployment analytics, benchmarking, recommendations */
  commandCenter: typeof commandCenterSvc;
  /** central assistant chat over product tools */
  assistant: typeof assistantSvc;
  /** unified agents + workflows view */
  automations: typeof automationsSvc;
}

export async function createCore(opts?: {
  dbUrl?: string;
  runWorkers?: boolean;
}): Promise<Core> {
  const config = loadConfig();
  const queryUrl = opts?.dbUrl ?? queryDatabaseUrl(config);
  const bossUrl = opts?.dbUrl ?? config.DATABASE_URL;
  const db = createDb(queryUrl);
  const storage = new ObjectStore();
  await storage.ensureBucket().catch(() => undefined);
  const ai = getAiProvider();

  let boss: PgBoss | undefined;
  if (opts?.runWorkers !== false) {
    // pg-boss needs session/direct Postgres (LISTEN/NOTIFY) — never the transaction pooler.
    // Keep this pool tiny: Supabase session pooler is often capped ~15, and a deploy
    // briefly runs two instances (query pool + realtime + boss × 2).
    boss = new PgBoss({
      connectionString: bossUrl,
      ssl: pgSsl(bossUrl, config.DATABASE_SSL),
      max: Math.min(3, Math.max(1, Math.floor(config.DATABASE_POOL_MAX / 3))),
    });
    boss.on("error", (err) => console.error("[pg-boss]", err.message));
    await boss.start();
  }

  const ctx = createCoreContext({ db, storage, ai, config, boss });

  const core: Core = {
    ctx,
    db,
    workersEnabled: Boolean(boss),
    workersStarted: false,
    async startWorkers() {
      if (!boss) throw new Error("workers disabled for this instance");
      await startWorkers(ctx, boss, config.JOB_CONCURRENCY);
      core.workersStarted = true;
    },
    async close() {
      await boss?.stop();
      await ctx.bus.close();
      const pool = (db as unknown as { $client: { end(): Promise<void> } }).$client;
      await pool.end();
    },
    session: workspaceSvc,
    fields: fieldsSvc,
    pipelines: pipelinesSvc,
    companies: companiesSvc,
    deals: dealsSvc,
    documents: documentsSvc,
    emails: emailsSvc,
    content: contentSvc,
    analytics: analyticsSvc,
    sharing: sharingSvc,
    intelligence: intelligenceSvc,
    automation: automationSvc,
    outbound: outboundSvc,
    vaults: vaultsSvc,
    agents: agentsSvc,
    spaces: spacesSvc,
    memory: memorySvc,
    research: researchSvc,
    commandCenter: commandCenterSvc,
    assistant: assistantSvc,
    automations: automationsSvc,
  };
  return core;
}

export * from "./context.js";
export * from "./errors.js";
export { mergeCompany, listCompanyRelationships } from "./services/companies.js";
export { resolveSession, getWorkspace, listCreditLedger, createApiKey, listApiKeys, revokeApiKey, ensureUserWorkspace } from "./services/workspace.js";
export type { ResolveSessionOpts, ResolvedSession } from "./services/workspace.js";
export { verifySupabaseJwt, normalizeSupabaseClaims } from "./supabase-jwt.js";
export type { SupabaseJwtClaims } from "./supabase-jwt.js";
export {
  assertPermission,
  memberPermissions,
  updateNotificationPrefs,
  getNotificationPrefs,
  PERMISSIONS,
} from "./services/workspace.js";
export type { Permission } from "./services/workspace.js";
export { grantCredits, spendCredits } from "./credits.js";
export type { AssistantToolHost } from "./services/assistant.js";
