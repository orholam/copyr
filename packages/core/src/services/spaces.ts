import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  activities,
  companies,
  documents,
  notes,
  portfolioUpdates,
  spaceParticipants,
  spaces,
  tasks,
  users,
} from "@copyr/db/schema.js";
import type {
  CreateSpaceInput,
  CreateTaskInput,
  SpaceDetailDto,
  SpaceParticipantDto,
  SpaceSummaryDto,
  TaskDto,
  UpdateTaskInput,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";
import { generateKeyBetween, initialKey } from "../fractional.js";

/* ── spaces ────────────────────────────────────────────────────────── */

export async function createSpace(
  ctx: CoreContext,
  session: Session,
  input: CreateSpaceInput,
): Promise<SpaceSummaryDto> {
  const [row] = await ctx.db
    .insert(spaces)
    .values({
      workspaceId: session.workspaceId,
      name: input.name,
      summary: input.summary ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "space",
    entityId: row.id,
    companyId: row.companyId,
    dealId: row.dealId,
    type: "space.created",
    summary: `Space "${row.name}" opened`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  if (input.provisionChecklist !== false) {
    await provisionDefaultTasks(ctx, row.id);
  }

  return mapSpaceSummary(row, await countOpenTasks(ctx, row.id), 0);
}

async function countOpenTasks(ctx: CoreContext, spaceId: string): Promise<number> {
  const [{ count }] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.spaceId, spaceId), sql`${tasks.status} != 'done'`));
  return count ?? 0;
}

/** Standard diligence tasks every deal space starts with. */
async function provisionDefaultTasks(ctx: CoreContext, spaceId: string): Promise<void> {
  const [space] = await ctx.db.select().from(spaces).where(eq(spaces.id, spaceId));
  const defaults = [
    "Founder deep-dive — product + vision",
    "Customer references — two current customers",
    "Market map — direct and adjacent competitors",
    "Data room review — contracts, IP, employment",
  ];
  let prev: string | null = null;
  for (const title of defaults) {
    const position: string = prev === null ? initialKey() : generateKeyBetween(prev, null);
    await ctx.db.insert(tasks).values({
      workspaceId: space!.workspaceId,
      spaceId,
      companyId: space?.companyId ?? null,
      dealId: space?.dealId ?? null,
      title,
      position,
    });
    prev = position;
  }
}

export async function listSpaces(ctx: CoreContext, session: Session): Promise<SpaceSummaryDto[]> {
  const rows = await ctx.db
    .select({
      space: spaces,
      openCount: sql<number>`(select count(*)::int from ${tasks} t where t.space_id = ${spaces.id} and t.status != 'done')`,
      participantCount: sql<number>`(select count(*)::int from ${spaceParticipants} p where p.space_id = ${spaces.id})`,
      companyName: companies.name,
    })
    .from(spaces)
    .leftJoin(companies, eq(companies.id, spaces.companyId))
    .where(and(eq(spaces.workspaceId, session.workspaceId), isNull(spaces.archivedAt)))
    .orderBy(desc(spaces.updatedAt));

  return rows.map((r) =>
    mapSpaceSummary(r.space, r.openCount ?? 0, r.participantCount ?? 0, r.companyName ?? undefined),
  );
}

/**
 * The full context bundle — documents, notes, updates, tasks, participants and
 * recent activity for one matter. This is what an agent (or a teammate) opens
 * with so no work starts from scratch.
 */
export async function getSpace(
  ctx: CoreContext,
  session: Session,
  spaceId: string,
): Promise<SpaceDetailDto> {
  const [space] = await ctx.db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.workspaceId, session.workspaceId)));
  if (!space) throw new CoreError("space not found", { status: 404 });

  const companyRow = space.companyId
    ? (await ctx.db.select().from(companies).where(eq(companies.id, space.companyId)))[0]
    : undefined;

  const dealRows = companyRow ? [companyRow] : [];

  const docRows = space.companyId
    ? await ctx.db
        .select()
        .from(documents)
        .where(eq(documents.companyId, space.companyId))
        .orderBy(desc(documents.createdAt))
        .limit(100)
    : [];

  const noteRows = space.companyId
    ? await ctx.db
        .select({ note: notes, authorName: users.name })
        .from(notes)
        .leftJoin(users, eq(notes.authorUserId, users.id))
        .where(eq(notes.companyId, space.companyId))
        .orderBy(desc(notes.createdAt))
        .limit(50)
    : [];

  const updateRows = space.companyId
    ? await ctx.db
        .select()
        .from(portfolioUpdates)
        .where(eq(portfolioUpdates.companyId, space.companyId))
        .orderBy(desc(portfolioUpdates.occurredAt))
        .limit(30)
    : [];

  const taskRows = await ctx.db
    .select({
      task: tasks,
      assigneeName: users.name,
      agentName: sql<string | null>`(select name from agents a where a.id = ${tasks.assigneeAgentId})`,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(eq(tasks.spaceId, spaceId))
    .orderBy(asc(tasks.position));

  const participants = await ctx.db
    .select()
    .from(spaceParticipants)
    .where(eq(spaceParticipants.spaceId, spaceId))
    .orderBy(asc(spaceParticipants.createdAt));

  const activityRows = await ctx.db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, session.workspaceId),
        space.companyId ? eq(activities.companyId, space.companyId) : sql`false`,
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(40);

  return {
    id: space.id,
    name: space.name,
    summary: space.summary,
    companyId: space.companyId,
    companyName: companyRow?.name,
    dealId: space.dealId,
    vaultId: space.vaultId,
    isShared: space.isShared,
    openTaskCount: taskRows.filter((t) => t.task.status !== "done").length,
    participantCount: participants.length,
    archivedAt: toIso(space.archivedAt),
    createdAt: toIso(space.createdAt)!,
    company: companyRow
      ? {
          id: companyRow.id,
          name: companyRow.name,
          domain: companyRow.domain,
          sector: companyRow.sector,
          description: companyRow.description,
          location: companyRow.location,
          status: companyRow.status,
        }
      : null,
    deals: dealRows.map((d) => ({
      id: d.id,
      title: d.name,
      roundStage: d.roundStage,
      askAmount: d.askAmount === null ? null : Number(d.askAmount),
      stageId: d.stageId,
      updatedAt: toIso(d.updatedAt)!,
    })),
    documents: docRows.map((d) => ({
      id: d.id,
      name: d.name,
      mime: d.mime,
      pageCount: d.pageCount,
      parseStatus: d.parseStatus,
      createdAt: toIso(d.createdAt)!,
    })),
    notes: noteRows.map((n) => ({
      id: n.note.id,
      body: n.note.body,
      authorUserId: n.note.authorUserId,
      authorName: n.authorName,
      pinned: n.note.pinned,
      createdAt: toIso(n.note.createdAt)!,
    })),
    portfolioUpdates: updateRows.map((u) => ({
      id: u.id,
      title: u.title,
      body: u.body,
      kind: u.kind,
      occurredAt: toIso(u.occurredAt)!,
    })),
    tasks: taskRows.map((t) =>
      mapTask(t.task, t.assigneeName, t.agentName),
    ),
    participants: participants.map(mapParticipant),
    recentActivity: activityRows.map((a) => ({
      id: a.id,
      type: a.type,
      actor: a.actor,
      summary: a.summary,
      createdAt: toIso(a.createdAt)!,
    })),
  };
}

/* ── tasks ─────────────────────────────────────────────────────────── */

export async function listTasks(
  ctx: CoreContext,
  session: Session,
  filter: { spaceId?: string; status?: string; limit?: number },
): Promise<{ items: TaskDto[]; total: number }> {
  const conds = [eq(tasks.workspaceId, session.workspaceId)];
  if (filter.spaceId) conds.push(eq(tasks.spaceId, filter.spaceId));
  if (filter.status) conds.push(eq(tasks.status, filter.status as never));
  const where = and(...conds);

  const rows = await ctx.db
    .select({
      task: tasks,
      assigneeName: users.name,
      agentName: sql<string | null>`(select name from agents a where a.id = ${tasks.assigneeAgentId})`,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(where)
    .orderBy(asc(tasks.position))
    .limit(filter.limit ?? 200);

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(tasks)
    .where(where);

  return { items: rows.map((t) => mapTask(t.task, t.assigneeName, t.agentName)), total };
}

export async function createTask(
  ctx: CoreContext,
  session: Session,
  input: CreateTaskInput,
): Promise<{ task: TaskDto; runId?: string }> {
  if (!input.spaceId && !input.companyId && !input.dealId) {
    throw new CoreError("task requires spaceId, companyId or dealId", { code: "missing_scope" });
  }

  // inherit scope from the space when only the space is given
  let companyId = input.companyId;
  let dealId = input.dealId;
  if (input.spaceId && !companyId) {
    const [space] = await ctx.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, input.spaceId), eq(spaces.workspaceId, session.workspaceId)));
    companyId = space?.companyId ?? undefined;
    dealId = dealId ?? space?.dealId ?? undefined;
  }

  const [{ maxPos }] = await ctx.db
    .select({ maxPos: sql<string | null>`max(${tasks.position})` })
    .from(tasks)
    .where(input.spaceId ? eq(tasks.spaceId, input.spaceId) : sql`false`);

  const [row] = await ctx.db
    .insert(tasks)
    .values({
      workspaceId: session.workspaceId,
      spaceId: input.spaceId ?? null,
      companyId: companyId ?? null,
      dealId: dealId ?? null,
      title: input.title,
      detail: input.detail ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeAgentId: input.assigneeAgentId ?? null,
      priority: input.priority ?? 0,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      position: maxPos ? generateKeyBetween(maxPos, null) : initialKey(),
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "task",
    entityId: row.id,
    companyId: row.companyId,
    dealId: row.dealId,
    type: "task.created",
    summary:
      `Task "${row.title}" created` +
      (row.assigneeAgentId ? ` and routed to an agent` : row.assigneeUserId ? ` and assigned` : ""),
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
  });

  // routing semantics: assigning to an agent immediately dispatches its run
  if (row.assigneeAgentId) {
    const { queueAgentRun } = await import("./agents.js");
    const queued = await queueAgentRun(ctx, session, row.assigneeAgentId, {
      companyId: row.companyId ?? undefined,
      dealId: row.dealId ?? undefined,
      spaceId: row.spaceId ?? undefined,
      taskId: row.id,
      trigger: "task",
    });
    return { task: mapTask(row), runId: queued.run.id };
  }

  return { task: mapTask(row) };
}

export async function updateTask(
  ctx: CoreContext,
  session: Session,
  taskId: string,
  patch: UpdateTaskInput,
): Promise<TaskDto> {
  const [row] = await ctx.db
    .update(tasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.detail !== undefined ? { detail: patch.detail ?? null } : {}),
      ...(patch.status !== undefined
        ? {
            status: patch.status,
            completedAt: patch.status === "done" ? new Date() : null,
          }
        : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId ?? null } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt ? new Date(patch.dueAt) : null } : {}),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, session.workspaceId)))
    .returning();
  if (!row) throw new CoreError("task not found", { status: 404 });

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "task",
    entityId: taskId,
    companyId: row.companyId,
    dealId: row.dealId,
    type: patch.status === "done" ? "task.completed" : "task.updated",
    summary:
      patch.status === "done"
        ? `Task "${row.title}" completed`
        : `Task "${row.title}" updated`,
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
  });

  return mapTask(row);
}

/* ── participants ──────────────────────────────────────────────────── */

export async function addParticipant(
  ctx: CoreContext,
  session: Session,
  spaceId: string,
  input: { email: string; name?: string; org?: string; role?: string },
): Promise<SpaceParticipantDto> {
  const [space] = await ctx.db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.workspaceId, session.workspaceId)));
  if (!space) throw new CoreError("space not found", { status: 404 });

  const [row] = await ctx.db
    .insert(spaceParticipants)
    .values({
      spaceId,
      email: input.email.toLowerCase(),
      name: input.name ?? null,
      org: input.org ?? null,
      role: input.role ?? "viewer",
      invitedByUserId: session.actor.userId,
    })
    .onConflictDoUpdate({
      target: [spaceParticipants.spaceId, spaceParticipants.email],
      set: { role: input.role ?? "viewer", name: input.name ?? null, org: input.org ?? null },
    })
    .returning();

  await ctx.db.update(spaces).set({ isShared: true }).where(eq(spaces.id, spaceId));

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "space",
    entityId: spaceId,
    companyId: space.companyId,
    dealId: space.dealId,
    type: "space.shared",
    summary: `${input.email} added to space "${space.name}" as ${row.role}`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  return mapParticipant(row);
}

/* ── mappers ───────────────────────────────────────────────────────── */

type SpaceRow = typeof spaces.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type ParticipantRow = typeof spaceParticipants.$inferSelect;

function mapSpaceSummary(
  row: SpaceRow,
  openTaskCount: number,
  participantCount: number,
  companyName?: string,
): SpaceSummaryDto {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    companyId: row.companyId,
    companyName,
    dealId: row.dealId,
    vaultId: row.vaultId,
    isShared: row.isShared,
    openTaskCount,
    participantCount,
    archivedAt: toIso(row.archivedAt),
    createdAt: toIso(row.createdAt)!,
  };
}

function mapTask(
  row: TaskRow,
  assigneeName?: string | null,
  assigneeAgentName?: string | null,
): TaskDto {
  return {
    id: row.id,
    spaceId: row.spaceId,
    companyId: row.companyId,
    dealId: row.dealId,
    title: row.title,
    detail: row.detail,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    assigneeName: assigneeName ?? undefined,
    assigneeAgentId: row.assigneeAgentId,
    assigneeAgentName: assigneeAgentName ?? undefined,
    priority: row.priority,
    dueAt: toIso(row.dueAt),
    position: row.position,
    completedAt: toIso(row.completedAt),
    createdAt: toIso(row.createdAt)!,
  };
}

function mapParticipant(row: ParticipantRow): SpaceParticipantDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    org: row.org,
    role: row.role,
  };
}
