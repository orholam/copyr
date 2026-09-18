import { and, desc, eq } from "drizzle-orm";
import { activities, notes, users, portfolioUpdates, companies, memberships as memberships2 } from "@copyr/db/schema.js";
import { sql } from "drizzle-orm";
import type { ActivityDto, NoteDto, PortfolioUpdateDto } from "@copyr/contracts";
import type { CoreContext, Session } from "../context.js";
import { mapActivity, mapNote, toIso } from "../mappers.js";
import { logActivity } from "../activity.js";
import { CoreError } from "../context.js";

export async function addNote(
  ctx: CoreContext,
  session: Session,
  input: { body: string; companyId?: string; dealId?: string; pinned?: boolean },
): Promise<NoteDto> {
  // resolve @Name mentions against workspace members
  const memberRows = await ctx.db
    .select({ userId: users.id, name: users.name })
    .from(users)
    .innerJoin(memberships2, eq(memberships2.userId, users.id))
    .where(eq(memberships2.workspaceId, session.workspaceId));
  const mentioned = memberRows.filter((m) =>
    new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`, "i").test(input.body),
  );

  const [row] = await ctx.db
    .insert(notes)
    .values({
      workspaceId: session.workspaceId,
      authorUserId: session.actor.userId,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      body: input.body,
      pinned: input.pinned ?? false,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "note",
    entityId: row.id,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    type: "note.added",
    summary: input.body.slice(0, 120),
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
    data: mentioned.length
      ? { mentions: mentioned.map((m) => ({ userId: m.userId, name: m.name })) }
      : null,
  });

  for (const m of mentioned) {
    await logActivity(ctx, ctx.db, {
      workspaceId: session.workspaceId,
      entityType: "note",
      entityId: row.id,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      type: "note.mention",
      summary: `${session.actor.source === "agent" ? "An agent" : "A teammate"} mentioned @${m.name}: "${input.body.slice(0, 80)}"`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: { mentionedUserId: m.userId },
    });
  }

  const author = row.authorUserId
    ? (await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, row.authorUserId)))[0]
    : undefined;
  return mapNote(row, author?.name ?? null);
}

export async function listNotes(
  ctx: CoreContext,
  session: Session,
  filter: { companyId?: string; dealId?: string },
): Promise<NoteDto[]> {
  const conds = [eq(notes.workspaceId, session.workspaceId)];
  if (filter.companyId) conds.push(eq(notes.companyId, filter.companyId));
  if (filter.dealId) conds.push(eq(notes.dealId, filter.dealId));
  const rows = await ctx.db
    .select({ note: notes, authorName: users.name })
    .from(notes)
    .leftJoin(users, eq(notes.authorUserId, users.id))
    .where(and(...conds))
    .orderBy(desc(notes.pinned), desc(notes.createdAt));
  return rows.map((r) => mapNote(r.note, r.authorName));
}

export async function deleteNote(ctx: CoreContext, session: Session, noteId: string): Promise<void> {
  const deleted = await ctx.db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.workspaceId, session.workspaceId)))
    .returning({ id: notes.id });
  if (!deleted.length) throw new CoreError("note not found", { status: 404 });
}

/* ── activity feed ─────────────────────────────────────────────────── */

export async function listActivity(
  ctx: CoreContext,
  session: Session,
  filter: {
    entityType?: string;
    entityId?: string;
    companyId?: string;
    dealId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: ActivityDto[]; total: number }> {
  const conds = [eq(activities.workspaceId, session.workspaceId)];
  if (filter.entityType && filter.entityId)
    conds.push(and(eq(activities.entityType, filter.entityType as never), eq(activities.entityId, filter.entityId))!);
  else if (filter.entityType) conds.push(eq(activities.entityType, filter.entityType as never));
  if (filter.companyId) conds.push(eq(activities.companyId, filter.companyId));
  if (filter.dealId) conds.push(eq(activities.dealId, filter.dealId));
  const where = and(...conds);

  const rows = await ctx.db
    .select()
    .from(activities)
    .where(where)
    .orderBy(desc(activities.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(activities)
    .where(where);
  return { items: rows.map(mapActivity), total };
}

/* ── portfolio timeline ────────────────────────────────────────────── */

export async function listPortfolioUpdates(
  ctx: CoreContext,
  session: Session,
  query: { companyId?: string; kind?: string; limit?: number; offset?: number },
): Promise<{ items: PortfolioUpdateDto[]; total: number }> {
  const conds = [eq(portfolioUpdates.workspaceId, session.workspaceId)];
  if (query.companyId) conds.push(eq(portfolioUpdates.companyId, query.companyId));
  if (query.kind) conds.push(eq(portfolioUpdates.kind, query.kind as never));
  const where = and(...conds);

  const rows = await ctx.db
    .select({ update: portfolioUpdates, companyName: companies.name })
    .from(portfolioUpdates)
    .innerJoin(companies, eq(portfolioUpdates.companyId, companies.id))
    .where(where)
    .orderBy(desc(portfolioUpdates.occurredAt))
    .limit(query.limit ?? 100)
    .offset(query.offset ?? 0);
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(portfolioUpdates)
    .where(where);

  return {
    items: rows.map(({ update, companyName }) => ({
      id: update.id,
      companyId: update.companyId,
      companyName,
      title: update.title,
      body: update.body,
      kind: update.kind,
      occurredAt: toIso(update.occurredAt)!,
      source: update.source,
      data: (update.data as Record<string, unknown>) ?? null,
    })),
    total,
  };
}

export async function createPortfolioUpdate(
  ctx: CoreContext,
  session: Session,
  input: { companyId: string; title: string; body?: string; kind?: PortfolioUpdateDto["kind"]; occurredAt?: string },
): Promise<PortfolioUpdateDto> {
  const [row] = await ctx.db
    .insert(portfolioUpdates)
    .values({
      workspaceId: session.workspaceId,
      companyId: input.companyId,
      title: input.title,
      body: input.body ?? null,
      kind: input.kind ?? "update",
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      source: session.actor.source === "agent" ? "agent" : "manual",
    })
    .returning();

  const [company] = await ctx.db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, input.companyId));

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "portfolio_update",
    entityId: row.id,
    companyId: input.companyId,
    type: "portfolio_update.created",
    summary: `Portfolio ${row.kind}: ${row.title}`,
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
    data: { companyName: company?.name },
  });

  return {
    id: row.id,
    companyId: row.companyId,
    companyName: company?.name,
    title: row.title,
    body: row.body,
    kind: row.kind,
    occurredAt: toIso(row.occurredAt)!,
    source: row.source,
    data: (row.data as Record<string, unknown>) ?? null,
  };
}
