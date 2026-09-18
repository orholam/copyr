import { and, desc, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  companies,
  documents,
  shareLinks,
  shareViews,
} from "@copyr/db/schema.js";
import type {
  CreateShareLinkInput,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { loadFieldMaps } from "./fields.js";
import { toIso } from "../mappers.js";

/** Attributes exposed when a link doesn't select its own set. */
const DEFAULT_PUBLIC_ATTRIBUTES = ["sector", "geography", "employees"];

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

export interface ShareLinkDtoLike {
  id: string;
  token: string;
  url: string;
  companyId: string;
  companyName: string;
  title: string;
  attributes: string[] | null;
  includeDocuments: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function mapLink(
  row: typeof shareLinks.$inferSelect,
  companyName: string,
  baseUrl: string,
): ShareLinkDtoLike {
  return {
    id: row.id,
    token: row.token,
    url: `${baseUrl}/share/${row.token}`,
    companyId: row.companyId,
    companyName,
    title: row.title,
    attributes: row.attributes ?? null,
    includeDocuments: row.includeDocuments,
    hasPassword: !!row.passwordHash,
    expiresAt: toIso(row.expiresAt),
    viewCount: row.viewCount,
    lastViewedAt: toIso(row.lastViewedAt),
    revokedAt: toIso(row.revokedAt),
    createdAt: toIso(row.createdAt)!,
  };
}

export async function createShareLink(
  ctx: CoreContext,
  session: Session,
  input: CreateShareLinkInput,
): Promise<ShareLinkDtoLike> {
  const salt = randomBytes(8).toString("hex");
  const [row] = await ctx.db
    .insert(shareLinks)
    .values({
      workspaceId: session.workspaceId,
      token: randomBytes(12).toString("base64url"),
      companyId: input.companyId,
      title: input.title,
      attributes: input.attributes ?? null,
      includeDocuments: input.includeDocuments,
      passwordHash: input.password ? `${salt}$${hashPassword(input.password, salt)}` : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdByUserId: session.actor.userId,
    })
    .returning();

  const [company] = await ctx.db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, input.companyId));

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "share_link",
    entityId: row.id,
    companyId: input.companyId,
    type: "share_link.created",
    summary: `Share link created for ${company?.name ?? input.companyId}`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  return mapLink(row, company?.name ?? "", ctx.config.PUBLIC_URL);
}

export async function listShareLinks(
  ctx: CoreContext,
  session: Session,
): Promise<ShareLinkDtoLike[]> {
  const rows = await ctx.db
    .select({ link: shareLinks, companyName: companies.name })
    .from(shareLinks)
    .innerJoin(companies, eq(shareLinks.companyId, companies.id))
    .where(eq(shareLinks.workspaceId, session.workspaceId))
    .orderBy(desc(shareLinks.createdAt));
  return rows.map((r) => mapLink(r.link, r.companyName, ctx.config.PUBLIC_URL));
}

export async function deleteShareLink(
  ctx: CoreContext,
  session: Session,
  linkId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(shareLinks)
    .where(and(eq(shareLinks.id, linkId), eq(shareLinks.workspaceId, session.workspaceId)))
    .returning({ id: shareLinks.id });
  if (!deleted.length) throw new CoreError("share link not found", { status: 404 });
}

export async function listShareViews(
  ctx: CoreContext,
  session: Session,
  linkId: string,
) {
  const rows = await ctx.db
    .select()
    .from(shareViews)
    .innerJoin(shareLinks, eq(shareViews.shareLinkId, shareLinks.id))
    .where(and(eq(shareViews.shareLinkId, linkId), eq(shareLinks.workspaceId, session.workspaceId)))
    .orderBy(desc(shareViews.viewedAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.share_views.id,
    viewedAt: toIso(r.share_views.viewedAt)!,
    ipHash: r.share_views.ipHash,
    userAgent: r.share_views.userAgent,
  }));
}

/* ── public access ─────────────────────────────────────────────────── */

export interface PublicCompanyView {
  locked: boolean;
  expired?: boolean;
  title?: string;
  company?: Record<string, unknown>;
  documents?: Array<{ id: string; name: string; downloadUrl: string }>;
}

/**
 * Public share view. Password-gated links return `{locked:true}` until the
 * correct password is supplied. Every successful render logs an access record.
 */
export async function resolvePublicShare(
  ctx: CoreContext,
  token: string,
  opts: { password?: string; ip?: string | null; userAgent?: string | null } = {},
): Promise<PublicCompanyView> {
  const [link] = await ctx.db.select().from(shareLinks).where(eq(shareLinks.token, token));
  if (!link) throw new CoreError("share link not found", { code: "not_found", status: 404 });
  if (link.revokedAt) throw new CoreError("share link revoked", { code: "revoked", status: 410 });
  if (link.expiresAt && link.expiresAt < new Date()) {
    throw new CoreError("share link expired", { code: "expired", status: 410 });
  }

  if (link.passwordHash) {
    const ok = opts.password
      ? (() => {
          const [salt] = link.passwordHash!.split("$");
          return `${salt}$${hashPassword(opts.password!, salt!)}` === link.passwordHash;
        })()
      : false;
    if (!ok) return { locked: true };
  }

  // load company + selected fields
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, link.companyId));
  if (!company) throw new CoreError("company not found", { status: 404 });

  const fieldMaps = await loadFieldMaps(ctx, link.workspaceId, "company", [company.id]);
  const fields = fieldMaps.get(company.id) ?? {};

  // which attribute keys are public?
  let allowedKeys: string[] = DEFAULT_PUBLIC_ATTRIBUTES;
  if (link.attributes && link.attributes.length) allowedKeys = link.attributes;

  const publicFields: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in fields && fields[key] !== null) publicFields[key] = fields[key];
  }

  const payload: PublicCompanyView = {
    locked: false,
    title: link.title,
    company: {
      name: company.name,
      ...(company.description ? { description: company.description } : {}),
      ...(company.location ? { location: company.location } : {}),
      ...publicFields,
    },
    documents: [],
  };

  if (link.includeDocuments) {
    const docs = await ctx.db
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, company.id), eq(documents.parseStatus, "parsed")))
      .orderBy(desc(documents.createdAt))
      .limit(10);
    for (const doc of docs.slice(0, 3)) {
      payload.documents!.push({
        id: doc.id,
        name: doc.name,
        downloadUrl: doc.storageKey ? await ctx.storage.signedUrl(doc.storageKey, 3600) : "",
      });
    }
  }

  // access log (fire-and-forget style but awaited for testability)
  await ctx.db.insert(shareViews).values({
    shareLinkId: link.id,
    ipHash: opts.ip ? createHash("sha256").update(opts.ip).digest("hex").slice(0, 16) : null,
    userAgent: opts.userAgent ?? null,
  });
  await ctx.db
    .update(shareLinks)
    .set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() })
    .where(eq(shareLinks.id, link.id));

  return payload;
}

export async function updateShareLink(
  ctx: CoreContext,
  session: Session,
  linkId: string,
  patch: {
    title?: string;
    attributes?: string[] | null;
    includeDocuments?: boolean;
    password?: string | null;
    expiresAt?: string | null;
    revoked?: boolean;
  },
): Promise<ShareLinkDtoLike> {
  const salt = randomBytes(4).toString("hex");
  const [row] = await ctx.db
    .update(shareLinks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.attributes !== undefined ? { attributes: patch.attributes } : {}),
      ...(patch.includeDocuments !== undefined ? { includeDocuments: patch.includeDocuments } : {}),
      ...(patch.password !== undefined
        ? { passwordHash: patch.password ? `${salt}$${hashPassword(patch.password, salt)}` : null }
        : {}),
      ...(patch.expiresAt !== undefined
        ? { expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : null }
        : {}),
      ...(patch.revoked !== undefined ? { revokedAt: patch.revoked ? new Date() : null } : {}),
    })
    .where(and(eq(shareLinks.id, linkId), eq(shareLinks.workspaceId, session.workspaceId)))
    .returning();
  if (!row) throw new CoreError("share link not found", { status: 404 });

  const [company] = await ctx.db.select({ name: companies.name }).from(companies).where(eq(companies.id, row.companyId));
  return mapLink(row, company?.name ?? "", ctx.config.PUBLIC_URL);
}
