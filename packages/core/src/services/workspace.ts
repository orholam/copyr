import { and, desc, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  apiKeys,
  companies,
  creditLedger,
  documents,
  intakeForms,
  memberships,
  pipelines,
  stages,
  users,
  workspaces,
} from "@copyr/db/schema.js";
import type { Actor } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";
import { verifySupabaseJwt, type SupabaseJwtClaims } from "../supabase-jwt.js";
import { ensureSystemAgents } from "./agents.js";
import { nextStagePosition } from "./companies.js";

/* ── session resolution ────────────────────────────────────────────── */

export interface ResolvedSession extends Session {
  workspaceSlug: string;
}

export interface ResolveSessionOpts {
  apiKey?: string | null;
  accessToken?: string | null;
  workspaceSlug?: string | null;
  /**
   * Trusted internal callers (inbound email webhooks, MCP stdio) may resolve
   * by workspace slug without a user JWT. HTTP requests should leave this unset
   * so `ALLOW_DEV_WORKSPACE_AUTH` (off in production) is the gate.
   */
  allowSlug?: boolean;
}

export async function resolveSession(
  ctx: CoreContext,
  opts: ResolveSessionOpts,
): Promise<ResolvedSession> {
  if (opts.apiKey) return resolveByApiKey(ctx, opts.apiKey);
  if (opts.accessToken) {
    return resolveByAccessToken(ctx, opts.accessToken, opts.workspaceSlug);
  }

  const allowSlug = opts.allowSlug ?? ctx.config.ALLOW_DEV_WORKSPACE_AUTH;
  if (!allowSlug) {
    throw new CoreError("missing credentials", { code: "unauthorized", status: 401 });
  }

  const slug = opts.workspaceSlug ?? ctx.config.DEV_WORKSPACE_SLUG;
  const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new CoreError(`workspace "${slug}" not found`, { code: "no_workspace", status: 404 });
  // dev default actor: the workspace owner
  const [owner] = await ctx.db
    .select({ userId: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.role, "owner")))
    .limit(1);
  const actor: Actor = { userId: owner?.userId ?? null, source: "api" };
  return { workspaceId: ws.id, workspaceSlug: ws.slug, actor };
}

async function resolveByAccessToken(
  ctx: CoreContext,
  accessToken: string,
  preferredSlug?: string | null,
): Promise<ResolvedSession> {
  const claims = await verifySupabaseJwt(accessToken, {
    supabaseUrl: ctx.config.SUPABASE_URL,
    jwtSecret: ctx.config.SUPABASE_JWT_SECRET,
    anonKey: ctx.config.SUPABASE_ANON_KEY,
  });
  return ensureUserWorkspace(ctx, claims, preferredSlug);
}

function displayNameFromClaims(claims: SupabaseJwtClaims): string {
  const meta = claims.userMetadata;
  for (const key of ["full_name", "name", "fullName"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (claims.email) return claims.email.split("@")[0] ?? "Member";
  return "Member";
}

function firmNameFromClaims(claims: SupabaseJwtClaims): string | null {
  const meta = claims.userMetadata;
  for (const key of ["firm_name", "firmName", "company", "workspace"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || "workspace";
}

export async function ensureUserWorkspace(
  ctx: CoreContext,
  claims: SupabaseJwtClaims,
  preferredSlug?: string | null,
): Promise<ResolvedSession> {
  const email = claims.email?.trim().toLowerCase() ?? null;
  const name = displayNameFromClaims(claims);

  let user =
    (await ctx.db.select().from(users).where(eq(users.id, claims.sub)).limit(1))[0] ??
    (email
      ? (await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0]
      : undefined);

  if (!user) {
    if (!email) {
      throw new CoreError("session is missing an email", { code: "unauthorized", status: 401 });
    }
    try {
      const [created] = await ctx.db
        .insert(users)
        .values({ id: claims.sub, email, name })
        .returning();
      user = created;
    } catch {
      user =
        (await ctx.db.select().from(users).where(eq(users.id, claims.sub)).limit(1))[0] ??
        (await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];
    }
  }
  if (!user) {
    throw new CoreError("could not provision user", { code: "unauthorized", status: 401 });
  }

  if (user.name !== name && name !== "Member") {
    await ctx.db.update(users).set({ name }).where(eq(users.id, user.id));
    user = { ...user, name };
  }

  const memberRows = await ctx.db
    .select({
      workspaceId: memberships.workspaceId,
      role: memberships.role,
      slug: workspaces.slug,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, user.id));

  if (preferredSlug) {
    const preferred = memberRows.find((m) => m.slug === preferredSlug);
    if (preferred) {
      return {
        workspaceId: preferred.workspaceId,
        workspaceSlug: preferred.slug,
        actor: { userId: user.id, source: "api" },
      };
    }
  }

  if (memberRows.length > 0) {
    const chosen = memberRows.find((m) => m.role === "owner") ?? memberRows[0]!;
    return {
      workspaceId: chosen.workspaceId,
      workspaceSlug: chosen.slug,
      actor: { userId: user.id, source: "api" },
    };
  }

  const provisioned = await provisionOwnerWorkspace(ctx, {
    userId: user.id,
    name: firmNameFromClaims(claims) ?? `${name}'s workspace`,
    slugSeed: firmNameFromClaims(claims) ?? (email ? email.split("@")[0]! : "workspace"),
  });
  return {
    workspaceId: provisioned.workspaceId,
    workspaceSlug: provisioned.workspaceSlug,
    actor: { userId: user.id, source: "api" },
  };
}

async function uniqueSlug(ctx: CoreContext, seed: string): Promise<string> {
  const base = slugify(seed);
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 32)}-${randomBytes(2).toString("hex")}`;
    const [hit] = await ctx.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, candidate)).limit(1);
    if (!hit) return candidate;
  }
  return `${base.slice(0, 24)}-${randomBytes(4).toString("hex")}`;
}

async function provisionOwnerWorkspace(
  ctx: CoreContext,
  input: { userId: string; name: string; slugSeed: string },
): Promise<{ workspaceId: string; workspaceSlug: string }> {
  const slug = await uniqueSlug(ctx, input.slugSeed);
  const [ws] = await ctx.db
    .insert(workspaces)
    .values({ name: input.name, slug, plan: "trial", aiCreditsBalance: 500 })
    .returning();

  await ctx.db.insert(memberships).values({
    workspaceId: ws.id,
    userId: input.userId,
    role: "owner",
  });

  const [pipeline] = await ctx.db
    .insert(pipelines)
    .values({ workspaceId: ws.id, name: "Deal Flow", isDefault: true, position: 0 })
    .returning();

  await ctx.db.insert(stages).values([
    { workspaceId: ws.id, pipelineId: pipeline.id, name: "Intake", color: "#94a3b8", kind: "active", position: 0 },
    { workspaceId: ws.id, pipelineId: pipeline.id, name: "Initial Review", color: "#6366f1", kind: "active", position: 1 },
    { workspaceId: ws.id, pipelineId: pipeline.id, name: "Due Diligence", color: "#f59e0b", kind: "active", position: 2 },
    { workspaceId: ws.id, pipelineId: pipeline.id, name: "Partner Meeting", color: "#8b5cf6", kind: "active", position: 3 },
    { workspaceId: ws.id, pipelineId: pipeline.id, name: "Committed", color: "#10b981", kind: "won", position: 4 },
    { workspaceId: ws.id, pipelineId: pipeline.id, name: "Passed", color: "#ef4444", kind: "lost", position: 5 },
  ]);

  await ctx.db.insert(creditLedger).values({
    workspaceId: ws.id,
    delta: 500,
    reason: "signup_grant",
    balanceAfter: 500,
  });

  await ensureSystemAgents(ctx, ws.id).catch(() => undefined);

  return { workspaceId: ws.id, workspaceSlug: ws.slug };
}

async function resolveByApiKey(ctx: CoreContext, secret: string): Promise<ResolvedSession> {
  const prefix = secret.slice(0, 12);
  const [key] = await ctx.db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), sql`${apiKeys.revokedAt} is null`));
  if (!key || key.keyHash !== sha256(secret)) {
    throw new CoreError("invalid API key", { code: "unauthorized", status: 401 });
  }
  await ctx.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, key.workspaceId));
  if (!ws) throw new CoreError("workspace not found for key", { status: 401 });
  return {
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    actor: { userId: null, source: "agent" },
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/* ── workspace overview ────────────────────────────────────────────── */

export async function getWorkspace(ctx: CoreContext, workspaceId: string) {
  const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new CoreError("workspace not found", { status: 404 });
  const members = await ctx.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      title: users.title,
      avatarUrl: users.avatarUrl,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId));
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    plan: ws.plan,
    aiCreditsBalance: ws.aiCreditsBalance,
    members,
  };
}

export async function listCreditLedger(ctx: CoreContext, workspaceId: string) {
  const rows = await ctx.db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.workspaceId, workspaceId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    refType: r.refType,
    balanceAfter: r.balanceAfter,
    createdAt: toIso(r.createdAt)!,
  }));
}

/* ── API keys ──────────────────────────────────────────────────────── */

export async function createApiKey(ctx: CoreContext, session: Session, name: string) {
  const secret = `ck_${randomBytes(24).toString("base64url")}`;
  const [row] = await ctx.db
    .insert(apiKeys)
    .values({
      workspaceId: session.workspaceId,
      name,
      prefix: secret.slice(0, 12),
      keyHash: sha256(secret),
    })
    .returning();
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: toIso(row.createdAt)!,
    secret,
  };
}

export async function listApiKeys(ctx: CoreContext, session: Session) {
  const rows = await ctx.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, session.workspaceId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    lastUsedAt: toIso(r.lastUsedAt),
    revokedAt: toIso(r.revokedAt),
    createdAt: toIso(r.createdAt)!,
  }));
}

export async function revokeApiKey(ctx: CoreContext, session: Session, keyId: string) {
  await ctx.db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, session.workspaceId)));
}

/* ── intake forms (website → pipeline) ─────────────────────────────── */

export async function createIntakeForm(
  ctx: CoreContext,
  session: Session,
  input: { name: string; landingStageId?: string },
) {
  const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const slug = `${slugBase}-${randomBytes(2).toString("hex")}`;
  const [row] = await ctx.db
    .insert(intakeForms)
    .values({
      workspaceId: session.workspaceId,
      name: input.name,
      slug,
      landingStageId: input.landingStageId ?? null,
      fields: [
        { key: "company_name", label: "Company name", required: true, type: "text" },
        { key: "website", label: "Website", required: false, type: "url" },
        { key: "one_liner", label: "One-liner", required: false, type: "text" },
        { key: "round", label: "Round", required: false, type: "text" },
        { key: "deck_url", label: "Deck link", required: false, type: "url" },
      ],
    })
    .returning();
  return row;
}

export async function listIntakeForms(ctx: CoreContext, session: Session) {
  return ctx.db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.workspaceId, session.workspaceId))
    .orderBy(desc(intakeForms.createdAt));
}

export async function getIntakeFormBySlug(ctx: CoreContext, slug: string) {
  const [row] = await ctx.db
    .select()
    .from(intakeForms)
    .where(and(eq(intakeForms.slug, slug), eq(intakeForms.isActive, true)));
  if (!row) throw new CoreError("form not found", { status: 404 });
  return row;
}

/**
 * Public form submission → company + deal in the form's landing stage.
 * Optional deck_url kicks off link conversion automatically.
 */
export async function submitIntakeForm(
  ctx: CoreContext,
  slug: string,
  submission: Record<string, string>,
): Promise<{ dealId: string; companyId: string }> {
  const form = await getIntakeFormBySlug(ctx, slug);

  for (const field of form.fields) {
    if (field.required && !submission[field.key]?.trim()) {
      throw new CoreError(`"${field.label}" is required`, { code: "validation_error", status: 422 });
    }
  }
  const companyName = submission["company_name"]?.trim();
  if (!companyName) {
    throw new CoreError('"company_name" is required', { code: "validation_error", status: 422 });
  }

  return ctx.db.transaction(async (tx) => {
    const stageRow = form.landingStageId
      ? (
          await tx.select().from(stages).where(eq(stages.id, form.landingStageId)).limit(1)
        )[0]
      : undefined;

    let pipelineId = stageRow?.pipelineId;
    if (!pipelineId) {
      const [pipeline] = await tx
        .select()
        .from(pipelines)
        .where(eq(pipelines.workspaceId, form.workspaceId))
        .orderBy(pipelines.position)
        .limit(1);
      pipelineId = pipeline!.id;
    }
    let stageId = stageRow?.id;
    if (!stageId) {
      const [firstStage] = await tx
        .select()
        .from(stages)
        .where(eq(stages.pipelineId, pipelineId!))
        .orderBy(stages.position)
        .limit(1);
      stageId = firstStage!.id;
    }

    const [existing] = await tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, form.workspaceId),
          sql`lower(${companies.name}) = lower(${companyName})`,
        ),
      );
    const round = submission["round"];
    let companyId: string;
    if (existing) {
      companyId = existing.id;
      await tx
        .update(companies)
        .set({
          ...(round ? { roundStage: round } : {}),
          updatedAt: new Date(),
        })
        .where(eq(companies.id, companyId));
    } else {
      const website = submission["website"];
      const position = await nextStagePosition(tx, stageId);
      const [company] = await tx
        .insert(companies)
        .values({
          workspaceId: form.workspaceId,
          name: companyName,
          domain: website ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null,
          description: submission["one_liner"] ?? null,
          source: "form",
          pipelineId: pipelineId!,
          stageId,
          roundStage: round ?? null,
          sourceRef: form.slug,
          position,
        })
        .returning();
      companyId = company.id;
    }

    await logActivity(ctx, tx, {
      workspaceId: form.workspaceId,
      entityType: "deal",
      entityId: companyId,
      companyId,
      dealId: companyId,
      type: "deal.created",
      summary: `Pitch submitted via intake form`,
      actor: "system",
      data: { form: form.slug },
    });

    if (submission["deck_url"]) {
      const [doc] = await tx
        .insert(documents)
        .values({
          workspaceId: form.workspaceId,
          companyId,
          dealId: companyId,
          name: `${companyName} — submitted deck`,
          sourceUrl: submission["deck_url"],
          source: "link_conversion",
          parseStatus: "pending",
        })
        .returning({ id: documents.id });
      await ctx.enqueue("convert-link", { workspaceId: form.workspaceId, documentId: doc.id });
    }

    return { dealId: companyId, companyId };
  });
}

/* ── RBAC permission sets ──────────────────────────────────────────── */

export const PERMISSIONS = [
  "manage_pipeline",
  "manage_fields",
  "manage_automations",
  "manage_webhooks",
  "manage_team",
  "manage_billing",
  "export_data",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_DEFAULTS: Record<string, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    "manage_pipeline",
    "manage_fields",
    "manage_automations",
    "manage_webhooks",
    "export_data",
  ],
  member: ["export_data"],
};

export async function memberPermissions(
  ctx: CoreContext,
  session: Session,
): Promise<Set<Permission>> {
  if (!session.actor.userId) {
    // agent/API-key callers operate with workspace-level authority
    return new Set(ROLE_DEFAULTS.owner);
  }
  const [m] = await ctx.db
    .select({ role: memberships.role, permissions: memberships.permissions })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, session.workspaceId),
        eq(memberships.userId, session.actor.userId),
      ),
    );
  if (!m) return new Set<Permission>(); // least privilege: no membership, no grants
  const granted = new Set<Permission>(ROLE_DEFAULTS[m.role] ?? []);
  for (const p of m.permissions ?? []) granted.add(p as Permission);
  return granted;
}

export async function assertPermission(
  ctx: CoreContext,
  session: Session,
  permission: Permission,
): Promise<void> {
  const perms = await memberPermissions(ctx, session);
  if (!perms.has(permission)) {
    throw new CoreError(`missing "${permission}" permission`, {
      code: "forbidden",
      status: 403,
    });
  }
}

/* ── per-member notification preferences ───────────────────────────── */

export async function getNotificationPrefs(
  ctx: CoreContext,
  session: Session,
): Promise<Record<string, unknown>> {
  if (!session.actor.userId) return {};
  const [m] = await ctx.db
    .select({ settings: memberships.settings })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, session.workspaceId),
        eq(memberships.userId, session.actor.userId),
      ),
    );
  const settings = (m?.settings as Record<string, unknown>) ?? {};
  return (settings.notifications as Record<string, unknown>) ?? {};
}

export async function updateNotificationPrefs(
  ctx: CoreContext,
  session: Session,
  notifications: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!session.actor.userId) throw new CoreError("no user in session", { status: 400 });
  const [m] = await ctx.db
    .select({ settings: memberships.settings })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, session.workspaceId),
        eq(memberships.userId, session.actor.userId),
      ),
    );
  const nextSettings = { ...((m?.settings as Record<string, unknown>) ?? {}), notifications };
  await ctx.db
    .update(memberships)
    .set({ settings: nextSettings })
    .where(
      and(
        eq(memberships.workspaceId, session.workspaceId),
        eq(memberships.userId, session.actor.userId),
      ),
    );
  return notifications;
}
