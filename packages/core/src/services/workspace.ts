import { and, desc, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  apiKeys,
  companies,
  creditLedger,
  deals,
  documents,
  intakeForms,
  memberships,
  pipelines,
  stages,
  users,
  workspaces,
} from "@copyr/db/schema.js";
import { sql } from "drizzle-orm";
import type { Actor } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { generateKeyBetween } from "../fractional.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";
import {
  supabaseAuthConfigured,
  verifySupabaseAccessToken,
  type VerifiedAuthUser,
} from "../auth/supabase-jwt.js";

/* ── session resolution ────────────────────────────────────────────── */

export interface ResolvedSession extends Session {
  workspaceSlug: string;
}

export interface ResolveSessionOpts {
  apiKey?: string | null;
  workspaceSlug?: string | null;
  accessToken?: string | null;
  /**
   * Allow slug-only resolution after a separate secret check (inbound email
   * webhooks). Does not apply to browser requests.
   */
  allowSlug?: boolean;
}

export async function resolveSession(
  ctx: CoreContext,
  opts: ResolveSessionOpts = {},
): Promise<ResolvedSession> {
  if (opts.apiKey) return resolveByApiKey(ctx, opts.apiKey);

  // A Bearer token must never fall through to the demo slug — invalid JWTs
  // would otherwise enter the seeded workspace as the owner.
  if (opts.accessToken) return resolveByAccessToken(ctx, opts.accessToken, opts.workspaceSlug);

  const allowSlug = opts.allowSlug === true || ctx.config.ALLOW_DEV_WORKSPACE_AUTH;
  if (!allowSlug) {
    throw new CoreError("authentication required", { code: "unauthorized", status: 401 });
  }
  return resolveBySlug(ctx, opts.workspaceSlug ?? ctx.config.DEV_WORKSPACE_SLUG);
}

async function resolveBySlug(ctx: CoreContext, slug: string): Promise<ResolvedSession> {
  const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new CoreError(`workspace "${slug}" not found`, { code: "no_workspace", status: 404 });
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
  workspaceSlug?: string | null,
): Promise<ResolvedSession> {
  if (!supabaseAuthConfigured(ctx.config) && !ctx.config.SUPABASE_ANON_KEY) {
    throw new CoreError("bearer token provided but Supabase auth is not configured on the API", {
      code: "unauthorized",
      status: 401,
    });
  }
  const authUser = await verifySupabaseAccessToken(ctx.config, accessToken);
  const user = await upsertUserFromAuth(ctx, authUser);
  return resolveMembership(ctx, user.id, workspaceSlug, authUser.firmName);
}

async function upsertUserFromAuth(ctx: CoreContext, authUser: VerifiedAuthUser) {
  const [byId] = await ctx.db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (byId) {
    if (byId.name !== authUser.name || byId.email !== authUser.email) {
      const [updated] = await ctx.db
        .update(users)
        .set({ name: authUser.name, email: authUser.email })
        .where(eq(users.id, byId.id))
        .returning();
      return updated ?? byId;
    }
    return byId;
  }

  const [row] = await ctx.db
    .insert(users)
    .values({
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: sql`excluded.name` },
    })
    .returning();
  if (!row) {
    throw new CoreError("failed to upsert user from auth token", { status: 500 });
  }
  return row;
}

async function resolveMembership(
  ctx: CoreContext,
  userId: string,
  workspaceSlug?: string | null,
  firmName?: string,
): Promise<ResolvedSession> {
  const memberRows = await ctx.db
    .select({
      workspaceId: memberships.workspaceId,
      role: memberships.role,
      slug: workspaces.slug,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));

  const actor: Actor = { userId, source: "api" };

  if (workspaceSlug) {
    const match = memberRows.find((m) => m.slug === workspaceSlug);
    if (match) {
      return { workspaceId: match.workspaceId, workspaceSlug: match.slug, actor };
    }
    if (memberRows.length > 0) {
      throw new CoreError("not a member of that workspace", { code: "forbidden", status: 403 });
    }
  }

  if (memberRows.length > 0) {
    const chosen = memberRows.find((m) => m.role === "owner") ?? memberRows[0];
    return { workspaceId: chosen.workspaceId, workspaceSlug: chosen.slug, actor };
  }

  const [authUser] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  return provisionWorkspaceForUser(ctx, {
    userId,
    name: authUser?.name ?? "Member",
    email: authUser?.email ?? "",
    firmName,
  });
}

const DEFAULT_STAGES: Array<{ name: string; color: string; kind: "active" | "won" | "lost" }> = [
  { name: "Intake", color: "#94a3b8", kind: "active" },
  { name: "Initial Review", color: "#6366f1", kind: "active" },
  { name: "Due Diligence", color: "#f59e0b", kind: "active" },
  { name: "Partner Meeting", color: "#8b5cf6", kind: "active" },
  { name: "Committed", color: "#10b981", kind: "won" },
  { name: "Passed", color: "#ef4444", kind: "lost" },
];

function slugify(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

/**
 * First-login provisioning: workspace + owner membership + default pipeline.
 * No extra tables — uses existing `workspaces` / `memberships` / `pipelines` / `stages`.
 */
export async function provisionWorkspaceForUser(
  ctx: CoreContext,
  input: { userId: string; name: string; email: string; firmName?: string },
): Promise<ResolvedSession> {
  const firm = input.firmName?.trim() || `${input.name}'s firm`;
  const slug = `${slugify(firm)}-${randomBytes(2).toString("hex")}`;

  return ctx.db.transaction(async (tx) => {
    const existing = await tx
      .select({
        workspaceId: memberships.workspaceId,
        slug: workspaces.slug,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, input.userId))
      .limit(1);
    if (existing[0]) {
      return {
        workspaceId: existing[0].workspaceId,
        workspaceSlug: existing[0].slug,
        actor: { userId: input.userId, source: "api" as const },
      };
    }

    const [ws] = await tx
      .insert(workspaces)
      .values({ name: firm, slug, plan: "trial", aiCreditsBalance: 500 })
      .returning();

    await tx.insert(memberships).values({
      workspaceId: ws.id,
      userId: input.userId,
      role: "owner",
    });

    const [pipeline] = await tx
      .insert(pipelines)
      .values({ workspaceId: ws.id, name: "Deal Flow", isDefault: true, position: 0 })
      .returning();

    await tx.insert(stages).values(
      DEFAULT_STAGES.map((s, i) => ({
        workspaceId: ws.id,
        pipelineId: pipeline.id,
        name: s.name,
        color: s.color,
        kind: s.kind,
        position: i,
      })),
    );

    return {
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      actor: { userId: input.userId, source: "api" as const },
    };
  });
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
    const [existing] = await tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, form.workspaceId),
          sql`lower(${companies.name}) = lower(${companyName})`,
        ),
      );
    let companyId: string;
    if (existing) {
      companyId = existing.id;
    } else {
      const website = submission["website"];
      const [company] = await tx
        .insert(companies)
        .values({
          workspaceId: form.workspaceId,
          name: companyName,
          domain: website ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null,
          description: submission["one_liner"] ?? null,
          source: "form",
        })
        .returning();
      companyId = company.id;
    }

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

    const [{ maxPos }] = await tx
      .select({ maxPos: sql<string | null>`max(${deals.position})` })
      .from(deals)
      .where(eq(deals.stageId, stageId));

    const round = submission["round"];
    const [deal] = await tx
      .insert(deals)
      .values({
        workspaceId: form.workspaceId,
        companyId,
        pipelineId: pipelineId!,
        stageId,
        title: `${companyName}${round ? ` — ${round}` : ""}`,
        roundStage: round ?? null,
        source: "form",
        sourceRef: form.slug,
        position: maxPos === null ? "a0" : generateKeyBetween(maxPos, null),
      })
      .returning();

    await logActivity(ctx, tx, {
      workspaceId: form.workspaceId,
      entityType: "deal",
      entityId: deal.id,
      companyId,
      dealId: deal.id,
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
          dealId: deal.id,
          name: `${companyName} — submitted deck`,
          sourceUrl: submission["deck_url"],
          source: "link_conversion",
          parseStatus: "pending",
        })
        .returning({ id: documents.id });
      await ctx.enqueue("convert-link", { workspaceId: form.workspaceId, documentId: doc.id });
    }

    return { dealId: deal.id, companyId };
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
