import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { companies, deals, pipelines, stages } from "@copyr/db/schema.js";
import type {
  CreateDealInput,
  DealDto,
  FieldValuePrimitive,
  ListDealsQuery,
  UpdateDealInput,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { mapDeal } from "../mappers.js";
import { logActivity } from "../activity.js";
import { generateKeyBetween } from "../fractional.js";
import { loadFieldMaps, setFieldValues } from "./fields.js";
import {
  getCompanyRow,
  findCompanyMatch,
  createCompany,
} from "./companies.js";
import { getDefaultPipeline, getStage } from "./pipelines.js";

type Exec = Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0];

export async function getDealRow(
  ctx: CoreContext,
  exec: CoreContext["db"] | Exec,
  workspaceId: string,
  dealId: string,
) {
  const [row] = await exec
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)));
  if (!row) throw new CoreError("deal not found", { status: 404 });
  return row;
}

async function hydrate(
  ctx: CoreContext,
  session: Session,
  rows: Array<{ deal: typeof deals.$inferSelect; company: typeof companies.$inferSelect }>,
): Promise<DealDto[]> {
  const dealFields = await loadFieldMaps(
    ctx,
    session.workspaceId,
    "deal",
    rows.map((r) => r.deal.id),
  );
  const companyFields = await loadFieldMaps(
    ctx,
    session.workspaceId,
    "company",
    rows.map((r) => r.company.id),
  );
  return rows.map(({ deal, company }) =>
    mapDeal(deal, company, {
      ...(companyFields.get(company.id) ?? {}),
      ...(dealFields.get(deal.id) ?? {}),
    }),
  );
}

export async function getDeal(
  ctx: CoreContext,
  session: Session,
  dealId: string,
): Promise<DealDto> {
  const row = await getDealRow(ctx, ctx.db, session.workspaceId, dealId);
  const company = await getCompanyRow(ctx, ctx.db, session.workspaceId, row.companyId);
  return (await hydrate(ctx, session, [{ deal: row, company }]))[0]!;
}

export async function listDeals(
  ctx: CoreContext,
  session: Session,
  query: ListDealsQuery,
): Promise<{ items: DealDto[]; total: number }> {
  const conds = [eq(deals.workspaceId, session.workspaceId)];

  if (query.pipelineId) conds.push(eq(deals.pipelineId, query.pipelineId));
  if (query.stageIds?.length) conds.push(inArray(deals.stageId, query.stageIds));
  if (query.archived === "true") conds.push(isNotNull(deals.archivedAt));
  else if (query.archived === "false") conds.push(isNull(deals.archivedAt));
  if (query.companyStatus) conds.push(eq(companies.status, query.companyStatus));
  if (query.ownerId?.length)
    conds.push(query.ownerId.includes("none") ? or(inArray(deals.ownerUserId, query.ownerId.filter((x) => x !== "none")), isNull(deals.ownerUserId))! : inArray(deals.ownerUserId, query.ownerId));
  if (query.source?.length) conds.push(inArray(deals.source, query.source));
  if (query.tags?.length) {
    // jsonb overlap: deal.tags ?| array
    const quoted = query.tags.map((t) => `"${t.replace(/"/g, '"\\"')}"`).join(",");
    conds.push(sql`${deals.tags} ?| array[${sql.raw(quoted)}]::text[]`);
  }
  if (query.roundStage?.length) conds.push(inArray(deals.roundStage, query.roundStage));
  if (query.minAsk !== undefined) conds.push(gte(deals.askAmount, String(query.minAsk)));
  if (query.maxAsk !== undefined) conds.push(lte(deals.askAmount, String(query.maxAsk)));
  if (query.createdAfter) conds.push(gte(deals.createdAt, new Date(query.createdAfter)));
  if (query.createdBefore) conds.push(lte(deals.createdAt, new Date(query.createdBefore)));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(companies.name, like), ilike(deals.title, like), ilike(companies.domain, like))!);
  }
  const where = and(...conds);

  const orderBy = (() => {
    const dir = query.order === "desc" ? desc : asc;
    switch (query.sort) {
      case "created_at":
        return dir(deals.createdAt);
      case "updated_at":
        return dir(deals.updatedAt);
      case "ask_amount":
        return dir(sql`${deals.askAmount} asc nulls last`);
      case "priority":
        return dir(deals.priority);
      case "company_name":
        return dir(companies.name);
      default:
        return [asc(stages.position), asc(deals.position)];
    }
  })();

  const rows = await ctx.db
    .select({ deal: deals, company: companies })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .leftJoin(stages, eq(deals.stageId, stages.id))
    .where(where)
    .orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]))
    .limit(query.limit)
    .offset(query.offset);

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .where(where);

  return { items: await hydrate(ctx, session, rows), total };
}

export interface CreateDealResult extends DealDto {
  companyCreated: boolean;
}

export async function createDeal(
  ctx: CoreContext,
  session: Session,
  input: CreateDealInput,
): Promise<CreateDealResult> {
  return ctx.db.transaction(async (tx) => {
    let companyId = input.companyId;
    let companyCreated = false;

    if (!companyId && !input.companyName) {
      throw new CoreError("companyId or companyName required", { code: "missing_company" });
    }

    if (!companyId) {
      // dedupe: reuse existing company when name/domain matches
      const existing = await findCompanyMatch(ctx, tx, session.workspaceId, input.companyName!, null);
      if (existing) {
        companyId = existing.id;
      } else {
        const company = await createCompany(ctx, session, { name: input.companyName! });
        companyId = company.id;
        companyCreated = true;
      }
    }

    const pipeline = input.pipelineId
      ? (
          await tx
            .select()
            .from(pipelines)
            .where(and(eq(pipelines.id, input.pipelineId), eq(pipelines.workspaceId, session.workspaceId)))
        )[0]
      : await getDefaultPipeline(ctx, tx, session.workspaceId);
    if (!pipeline) throw new CoreError("pipeline not found", { status: 404 });

    const stage = input.stageId
      ? await getStage(ctx, tx, session.workspaceId, input.stageId)
      : (
          await tx
            .select()
            .from(stages)
            .where(eq(stages.pipelineId, pipeline.id))
            .orderBy(asc(stages.position))
        )[0];
    if (!stage) throw new CoreError("no stages configured for pipeline", { status: 500 });

    const [{ maxPos }] = await tx
      .select({ maxPos: sql<string | null>`max(${deals.position})` })
      .from(deals)
      .where(and(eq(deals.stageId, stage.id), isNull(deals.archivedAt)));

    const [row] = await tx
      .insert(deals)
      .values({
        workspaceId: session.workspaceId,
        companyId: companyId!,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerUserId: input.ownerUserId ?? null,
        title: input.title ?? `${input.companyName ?? "Deal"}`,
        roundStage: input.roundStage ?? null,
        askAmount: input.askAmount != null ? String(input.askAmount) : null,
        valuation: input.valuation != null ? String(input.valuation) : null,
        priority: input.priority ?? 0,
        nextStepAt: input.nextStepAt ? new Date(input.nextStepAt) : null,
        source: session.actor.source === "agent" ? "agent" : session.actor.source === "api" ? "api" : "manual",
        sourceRef: input.sourceRef ?? null,
        createdByUserId: session.actor.userId,
        position: generateKeyBetween(maxPos, null),
      })
      .returning();

    if (input.fields) {
      await setFieldValues(
        ctx,
        tx as unknown as Exec,
        session,
        "deal",
        row.id,
        input.fields as Record<string, FieldValuePrimitive>,
      );
    }

    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "deal",
      entityId: row.id,
      companyId: row.companyId,
      dealId: row.id,
      type: "deal.created",
      summary: `Deal "${row.title}" created`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: { stage: stage.name, source: row.source },
    });

    const createdId = row.id;
    return { createdId, companyCreated };
  }).then(async ({ createdId, companyCreated }) => {
    const dto = await getDeal(ctx, session, createdId);
    return { ...dto, companyCreated };
  });
}

export async function updateDeal(
  ctx: CoreContext,
  session: Session,
  dealId: string,
  patch: UpdateDealInput,
): Promise<DealDto> {
  return ctx.db.transaction(async (tx) => {
    const row0 = await getDealRow(ctx, tx, session.workspaceId, dealId);
    const { fields, archived, stageId, ownerUserId, nextStepAt, askAmount, valuation, ...rest } = patch;
    void rest;

    let stageChangedStageName: string | null = null;
    let position = undefined as string | undefined;

    if (stageId && stageId !== row0.stageId) {
      const stage = await getStage(ctx, tx, session.workspaceId, stageId);
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<string | null>`max(${deals.position})` })
        .from(deals)
        .where(and(eq(deals.stageId, stage.id), isNull(deals.archivedAt)));
      position = generateKeyBetween(maxPos, null);
      stageChangedStageName = stage.name;
    }

    const [row] = await tx
      .update(deals)
      .set({
        ...rest,
        ...(stageId ? { stageId } : {}),
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
        ...(position ? { position } : {}),
        ...(askAmount !== undefined ? { askAmount: askAmount === null ? null : String(askAmount) } : {}),
        ...(valuation !== undefined ? { valuation: valuation === null ? null : String(valuation) } : {}),
        ...(nextStepAt !== undefined
          ? { nextStepAt: nextStepAt === null ? null : new Date(nextStepAt) }
          : {}),
        ...(archived !== undefined
          ? { archivedAt: archived ? new Date() : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(deals.id, dealId), eq(deals.workspaceId, session.workspaceId)))
      .returning();

    if (fields) {
      await setFieldValues(
        ctx,
        tx as unknown as Exec,
        session,
        "deal",
        dealId,
        fields as Record<string, FieldValuePrimitive>,
      );
    }

    if (stageChangedStageName) {
      await logActivity(ctx, tx, {
        workspaceId: session.workspaceId,
        entityType: "deal",
        entityId: dealId,
        companyId: row.companyId,
        dealId,
        type: "deal.stage_changed",
        summary: `Moved to ${stageChangedStageName}`,
        actor: session.actor.userId ? "user" : session.actor.source === "agent" ? "ai" : "system",
        actorUserId: session.actor.userId,
        data: { from: row0.stageId, to: row.stageId },
      });
    }
    if (archived !== undefined) {
      await logActivity(ctx, tx, {
        workspaceId: session.workspaceId,
        entityType: "deal",
        entityId: dealId,
        companyId: row.companyId,
        dealId,
        type: archived ? "deal.archived" : "deal.updated",
        summary: archived ? `Deal "${row.title}" archived` : `Deal "${row.title}" restored`,
        actor: session.actor.userId ? "user" : "system",
        actorUserId: session.actor.userId,
      });
    }

    return row.id;
  }).then((id) => getDeal(ctx, session, id));
}

/** Kanban drag-and-drop: place deal before another (or append). */
export async function moveDeal(
  ctx: CoreContext,
  session: Session,
  dealId: string,
  input: { stageId?: string; beforeDealId?: string | null },
): Promise<DealDto> {
  return ctx.db.transaction(async (tx) => {
    const row0 = await getDealRow(ctx, tx, session.workspaceId, dealId);
    const targetStageId = input.stageId ?? row0.stageId;
    if (input.stageId) await getStage(ctx, tx, session.workspaceId, input.stageId);

    let beforePos: string | null = null;
    let afterPos: string | null = null;

    if (input.beforeDealId != null) {
      const before = await getDealRow(ctx, tx, session.workspaceId, input.beforeDealId);
      if (before.stageId !== targetStageId) {
        throw new CoreError("beforeDealId must be in the same stage", { status: 422 });
      }
      // find the key immediately before `before` within the stage
      const [prev] = await tx
        .select({ position: deals.position })
        .from(deals)
        .where(
          and(
            eq(deals.stageId, targetStageId),
            sql`${deals.position} < ${before.position}`,
            sql`${deals.id} <> ${dealId}`,
          ),
        )
        .orderBy(desc(deals.position))
        .limit(1);
      afterPos = prev?.position ?? null;
      beforePos = before.position;
    } else {
      // append at end of target stage
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<string | null>`max(${deals.position})` })
        .from(deals)
        .where(and(eq(deals.stageId, targetStageId), isNull(deals.archivedAt)));
      afterPos = maxPos;
    }

    const position = generateKeyBetween(afterPos, beforePos);

    const [row] = await tx
      .update(deals)
      .set({
        stageId: targetStageId,
        position,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, dealId))
      .returning();

    if (targetStageId !== row0.stageId) {
      const stage = await getStage(ctx, tx, session.workspaceId, targetStageId);
      await logActivity(ctx, tx, {
        workspaceId: session.workspaceId,
        entityType: "deal",
        entityId: dealId,
        companyId: row.companyId,
        dealId,
        type: "deal.stage_changed",
        summary: `Moved to ${stage.name}`,
        actor: session.actor.userId ? "user" : "system",
        actorUserId: session.actor.userId,
        data: { from: row0.stageId, to: targetStageId },
      });
    }

    const company = await getCompanyRow(ctx, tx, session.workspaceId, row.companyId);
    return (await hydrate(ctx, session, [{ deal: row, company }]))[0]!;
  });
}
