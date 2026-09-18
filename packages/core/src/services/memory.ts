import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { memories, users } from "@copyr/db/schema.js";
import type { CreateMemoryInput, MemoryDto } from "@copyr/contracts";
import type { CoreContext, Session } from "../context.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";

/**
 * Fund + partner memory: declared preferences ("we never lead pre-seed"),
 * learned facts (from corrections), processes. Memory is inspectable,
 * editable and never used to train models — it scopes every AI answer.
 */
export async function remember(
  ctx: CoreContext,
  session: Session,
  input: CreateMemoryInput,
): Promise<MemoryDto> {
  const [row] = await ctx.db
    .insert(memories)
    .values({
      workspaceId: session.workspaceId,
      userId: input.userId ?? null, // null = fund-wide
      kind: input.kind ?? "preference",
      source: "declared",
      content: input.content.trim(),
      pinned: input.pinned ?? false,
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "memory",
    entityId: row.id,
    type: "memory.added",
    summary: `Remembered (${row.kind}): ${row.content.slice(0, 100)}`,
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
  });

  return mapMemory(row);
}

/** Record an inferred preference from observed behavior (corrections/edits). */
export async function learn(
  ctx: CoreContext,
  workspaceId: string,
  input: { content: string; kind?: "preference" | "focus_area" | "process" | "fact"; userId?: string },
): Promise<MemoryDto> {
  const [existing] = await ctx.db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, workspaceId),
        eq(memories.source, "learned"),
        sql`lower(${memories.content}) = lower(${input.content.trim()})`,
      ),
    )
    .limit(1);

  if (existing) {
    const [row] = await ctx.db
      .update(memories)
      .set({ weight: existing.weight + 1, updatedAt: new Date() })
      .where(eq(memories.id, existing.id))
      .returning();
    return mapMemory(row);
  }

  const [row] = await ctx.db
    .insert(memories)
    .values({
      workspaceId,
      userId: input.userId ?? null,
      kind: input.kind ?? "preference",
      source: "learned",
      content: input.content.trim(),
    })
    .returning();
  return mapMemory(row);
}

export async function listMemories(
  ctx: CoreContext,
  session: Session,
  filter: { userId?: string | null; kind?: string; limit?: number },
): Promise<MemoryDto[]> {
  const conds = [eq(memories.workspaceId, session.workspaceId)];
  if (filter.userId !== undefined) {
    // null = fund-wide only
    if (filter.userId === null) conds.push(isNull(memories.userId));
    else conds.push(or(eq(memories.userId, filter.userId), isNull(memories.userId))!);
  }
  if (filter.kind) conds.push(eq(memories.kind, filter.kind as never));

  const rows = await ctx.db
    .select()
    .from(memories)
    .where(and(...conds))
    .orderBy(desc(memories.pinned), desc(memories.weight), desc(memories.updatedAt))
    .limit(filter.limit ?? 100);
  return rows.map(mapMemory);
}

export async function forget(
  ctx: CoreContext,
  session: Session,
  memoryId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.workspaceId, session.workspaceId)))
    .returning({ id: memories.id });
  if (!deleted.length) throw new Error("memory not found");

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "memory",
    entityId: memoryId,
    type: "memory.forgot",
    summary: "A memory was removed",
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
  });
}

/** Highest-weight memory lines for prompt grounding. */
export async function groundingMemories(
  ctx: CoreContext,
  workspaceId: string,
  userId?: string | null,
  limit = 12,
): Promise<Array<{ id: string; content: string; sourceName: string }>> {
  const conds = [eq(memories.workspaceId, workspaceId)];
  if (userId) conds.push(or(eq(memories.userId, userId), isNull(memories.userId))!);

  const rows = await ctx.db
    .select({ id: memories.id, content: memories.content, authorName: users.name })
    .from(memories)
    .leftJoin(users, eq(users.id, memories.userId))
    .where(and(...conds))
    .orderBy(desc(memories.pinned), desc(memories.weight))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    sourceName: r.authorName ? `${r.authorName}'s preference` : "Fund preference",
  }));
}

type MemoryRow = typeof memories.$inferSelect;

function mapMemory(row: MemoryRow): MemoryDto {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    source: row.source,
    content: row.content,
    weight: row.weight,
    pinned: row.pinned,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}
