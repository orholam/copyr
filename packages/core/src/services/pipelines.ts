import { and, asc, eq, max, sql } from "drizzle-orm";
import { pipelines, stages } from "@copyr/db/schema.js";
import type { PipelineDto, StageDto } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { mapPipeline, mapStage } from "../mappers.js";
import { logActivity } from "../activity.js";

export async function listPipelines(
  ctx: CoreContext,
  session: Session,
): Promise<PipelineDto[]> {
  const pipeRows = await ctx.db
    .select()
    .from(pipelines)
    .where(eq(pipelines.workspaceId, session.workspaceId))
    .orderBy(asc(pipelines.position));
  const stageRows = await ctx.db
    .select()
    .from(stages)
    .where(eq(stages.workspaceId, session.workspaceId))
    .orderBy(asc(stages.position));
  return pipeRows.map((p) =>
    mapPipeline(p, stageRows.filter((s) => s.pipelineId === p.id)),
  );
}

export async function getDefaultPipeline(
  ctx: CoreContext,
  exec: Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0] | CoreContext["db"],
  workspaceId: string,
) {
  const rows = await exec
    .select()
    .from(pipelines)
    .where(eq(pipelines.workspaceId, workspaceId))
    .orderBy(asc(pipelines.position));
  const chosen = rows.find((r) => r.isDefault) ?? rows[0];
  if (!chosen) throw new CoreError("no pipeline configured", { status: 500 });
  return chosen;
}

export async function getStage(
  ctx: CoreContext,
  exec: Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0] | CoreContext["db"],
  workspaceId: string,
  stageId: string,
) {
  const [row] = await exec
    .select()
    .from(stages)
    .where(and(eq(stages.id, stageId), eq(stages.workspaceId, workspaceId)));
  if (!row) throw new CoreError("stage not found", { status: 404 });
  return row;
}

export async function createStage(
  ctx: CoreContext,
  session: Session,
  input: { pipelineId?: string; name: string; color?: string; kind?: "active" | "won" | "lost" },
): Promise<StageDto> {
  return ctx.db.transaction(async (tx) => {
    const pipeline = input.pipelineId
      ? await tx
          .select()
          .from(pipelines)
          .where(and(eq(pipelines.id, input.pipelineId), eq(pipelines.workspaceId, session.workspaceId)))
          .then((rows) => rows[0])
      : await getDefaultPipeline(ctx, tx, session.workspaceId);
    if (!pipeline) throw new CoreError("pipeline not found", { status: 404 });

    const [{ maxPos }] = await tx
      .select({ maxPos: max(stages.position) })
      .from(stages)
      .where(eq(stages.pipelineId, pipeline.id));

    const [row] = await tx
      .insert(stages)
      .values({
        workspaceId: session.workspaceId,
        pipelineId: pipeline.id,
        name: input.name,
        color: input.color ?? "#6366f1",
        kind: input.kind ?? "active",
        position: (maxPos ?? -1) + 1,
      })
      .returning();

    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "stage",
      entityId: row.id,
      type: "stage.created",
      summary: `Stage "${row.name}" created`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: { pipelineId: pipeline.id },
    });
    return mapStage(row);
  });
}

export async function updateStage(
  ctx: CoreContext,
  session: Session,
  stageId: string,
  patch: { name?: string; color?: string; kind?: "active" | "won" | "lost" },
): Promise<StageDto> {
  const [row] = await ctx.db
    .update(stages)
    .set(patch)
    .where(and(eq(stages.id, stageId), eq(stages.workspaceId, session.workspaceId)))
    .returning();
  if (!row) throw new CoreError("stage not found", { status: 404 });
  return mapStage(row);
}

export async function deleteStage(
  ctx: CoreContext,
  session: Session,
  stageId: string,
): Promise<void> {
  const dealsIn = await ctx.db.execute(
    sql`select count(*)::int as count from deals where stage_id = ${stageId}`,
  );
  const count = (dealsIn.rows[0] as unknown as { count: number }).count;
  if (count > 0) {
    throw new CoreError(`stage still holds ${count} deal(s); move them first`, {
      code: "stage_not_empty",
      status: 409,
    });
  }
  const deleted = await ctx.db
    .delete(stages)
    .where(and(eq(stages.id, stageId), eq(stages.workspaceId, session.workspaceId)))
    .returning({ id: stages.id });
  if (!deleted.length) throw new CoreError("stage not found", { status: 404 });
}
