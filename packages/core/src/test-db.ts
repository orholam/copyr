import { randomUUID, createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@copyr/db";
import { apiKeys, companies, memberships, pipelines, stages, users, workspaces } from "@copyr/db/schema.js";
import type { Database } from "@copyr/db";
import { loadConfig } from "@copyr/config";
import { ObjectStore } from "@copyr/storage";
import { MockProvider } from "@copyr/ai";

import { createCoreContext, type CoreContext } from "./context.js";
import { initialKey } from "./fractional.js";

/**
 * Shared DB-backed test support: connects once per process, auto-applies
 * drizzle migrations when the schema is missing, and returns null when no
 * database is reachable so suites can skip cleanly.
 */
let cachedDb: Database | null | undefined;

async function ensureSchema(db: Database): Promise<void> {
  const res = await db.execute(sql`select to_regclass('public.workspaces') as reg`);
  const rows = (((res as unknown) as { rows?: Array<{ reg: string | null }> }).rows ?? []) as Array<{
    reg: string | null;
  }>;
  if (!rows[0]?.reg) {
    const folder = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
    await migrate(db, { migrationsFolder: folder });
  }
}

export async function getTestDb(): Promise<Database | null> {
  if (cachedDb !== undefined) return cachedDb;
  cachedDb = null;
  let db: Database | undefined;
  try {
    db = createDb(loadConfig().DATABASE_URL);
    await Promise.race([
      (async () => {
        await db!.execute(sql`select 1`);
        await ensureSchema(db!);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("database unreachable")), 5000)),
    ]);
    cachedDb = db;
  } catch {
    if (db) {
      const pool = (db as unknown as { $client?: { end(): Promise<void> } }).$client;
      await pool?.end().catch(() => undefined);
    }
  }
  return cachedDb;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface WsFixture {
  ctx: CoreContext;
  db: Database;
  workspaceId: string;
  workspaceSlug: string;
  userIds: { owner: string; admin: string; member: string };
  apiKeyId: string;
  apiKeySecret: string;
  pipelineId: string;
  stageIds: { sourcing: string; won: string };
  companyId: string;
  dealId: string;
}

/** Creates an isolated workspace graph with owner/admin/member users and an API key. */
export async function seedWorkspace(db: Database): Promise<WsFixture> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `t-${suffix}`;
  const ctx = createCoreContext({
    db,
    storage: new ObjectStore(),
    ai: new MockProvider(),
    config: loadConfig({ NODE_ENV: "test" }),
  });

  const [ws] = await db
    .insert(workspaces)
    .values({ name: `Test WS ${suffix}`, slug })
    .returning();

  const mkUser = async (name: string) => {
    const [u] = await db
      .insert(users)
      .values({ email: `${name.toLowerCase()}-${suffix}@test.copyr.dev`, name })
      .returning();
    return u.id;
  };
  const [owner, admin, member] = await Promise.all([mkUser("Owner"), mkUser("Admin"), mkUser("Member")]);
  await db.insert(memberships).values([
    { workspaceId: ws.id, userId: owner, role: "owner" },
    { workspaceId: ws.id, userId: admin, role: "admin" },
    { workspaceId: ws.id, userId: member, role: "member" },
  ]);

  const [pipeline] = await db
    .insert(pipelines)
    .values({ workspaceId: ws.id, name: "Main", isDefault: true, position: 0 })
    .returning();
  const stageRows = await db
    .insert(stages)
    .values([
      { workspaceId: ws.id, pipelineId: pipeline.id, name: "Sourcing", kind: "active", position: 0 },
      { workspaceId: ws.id, pipelineId: pipeline.id, name: "Won", kind: "won", position: 1 },
    ])
    .returning();

  const [company] = await db
    .insert(companies)
    .values({
      workspaceId: ws.id,
      name: `Acme ${suffix}`,
      domain: `acme-${suffix}.test`,
      pipelineId: pipeline.id,
      stageId: stageRows[0].id,
      position: initialKey(),
    })
    .returning();

  const secret = `ck_${randomBytes(24).toString("base64url")}`;
  const [key] = await db
    .insert(apiKeys)
    .values({
      workspaceId: ws.id,
      name: "test-key",
      prefix: secret.slice(0, 12),
      keyHash: sha256(secret),
    })
    .returning();

  return {
    ctx,
    db,
    workspaceId: ws.id,
    workspaceSlug: slug,
    userIds: { owner, admin, member },
    apiKeyId: key.id,
    apiKeySecret: secret,
    pipelineId: pipeline.id,
    stageIds: { sourcing: stageRows[0].id, won: stageRows[1].id },
    companyId: company.id,
    dealId: company.id,
  };
}

/** Removes everything created by seedWorkspace (FKs cascade). */
export async function cleanupWorkspace(fx: WsFixture): Promise<void> {
  const ids = Object.values(fx.userIds);
  await fx.db.delete(users).where(inArray(users.id, ids));
  await fx.db.delete(workspaces).where(eq(workspaces.id, fx.workspaceId));
  await fx.ctx.bus.close().catch(() => undefined);
}
