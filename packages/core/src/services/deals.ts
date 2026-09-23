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
import { companies, stages } from "@copyr/db/schema.js";
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
import { findCompanyMatch, createCompany, nextStagePosition } from "./companies.js";
import { getStage } from "./pipelines.js";

type Exec = Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0];

export async function getDealRow(
  ctx: CoreContext,
  exec: CoreContext["db"] | Exec,
  workspaceId: string,
  dealId: string,
) {
  const [row] = await exec
    .select()
    .from(companies)
    .where(and(eq(companies.id, dealId), eq(companies.workspaceId, workspaceId)));
  if (!row) throw new CoreError("deal not found", { status: 404 });
  return row;
}

async function hydrate(
  ctx: CoreContext,
  session: Session,
  rows: Array<typeof companies.$inferSelect>,
): Promise<DealDto[]> {
  const fields = await loadFieldMaps(
    ctx,
    session.workspaceId,
    "company",
    rows.map((r) => r.id),
  );
  return rows.map((row) => mapDeal(row, row, fields.get(row.id) ?? {}));
}

export async function getDeal(
  ctx: CoreContext,
  session: Session,
  dealId: string,
): Promise<DealDto> {
  const row = await getDealRow(ctx, ctx.db, session.workspaceId, dealId);
  return (await hydrate(ctx, session, [row]))[0]!;
}

export async function listDeals(
  ctx: CoreContext,
  session: Session,
  query: ListDealsQuery,
): Promise<{ items: DealDto[]; total: number }> {
  const conds = [eq(companies.workspaceId, session.workspaceId)];

  if (query.pipelineId) conds.push(eq(companies.pipelineId, query.pipelineId));
  if (query.stageIds?.length) conds.push(inArray(companies.stageId, query.stageIds));
  if (query.archived === "true") conds.push(isNotNull(companies.archivedAt));
  else if (query.archived === "false") conds.push(isNull(companies.archivedAt));
  if (query.companyStatus) conds.push(eq(companies.status, query.companyStatus));
  if (query.ownerId?.length)
    conds.push(
      query.ownerId.includes("none")
        ? or(inArray(companies.ownerUserId, query.ownerId.filter((x) => x !== "none")), isNull(companies.ownerUserId))!
        : inArray(companies.ownerUserId, query.ownerId),
    );
  if (query.source?.length) conds.push(inArray(companies.source, query.source));
  if (query.tags?.length) {
    const quoted = query.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",");
    conds.push(sql`${companies.tags} ?| array[${sql.raw(quoted)}]::text[]`);
  }
  if (query.roundStage?.length) conds.push(inArray(companies.roundStage, query.roundStage));
  if (query.minAsk !== undefined) conds.push(gte(companies.askAmount, String(query.minAsk)));
  if (query.maxAsk !== undefined) conds.push(lte(companies.askAmount, String(query.maxAsk)));
  if (query.createdAfter) conds.push(gte(companies.createdAt, new Date(query.createdAfter)));
  if (query.createdBefore) conds.push(lte(companies.createdAt, new Date(query.createdBefore)));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(companies.name, like), ilike(companies.domain, like))!);
  }
  const where = and(...conds);

  const orderBy = (() => {
    const dir = query.order === "desc" ? desc : asc;
    switch (query.sort) {
      case "created_at":
        return dir(companies.createdAt);
      case "updated_at":
        return dir(companies.updatedAt);
      case "ask_amount":
        return dir(sql`${companies.askAmount} asc nulls last`);
      case "priority":
        return dir(companies.priority);
      case "company_name":
        return dir(companies.name);
      default:
        return [asc(stages.position), asc(companies.position)];
    }
  })();

  const rows = await ctx.db
    .select({ company: companies })
    .from(companies)
    .leftJoin(stages, eq(companies.stageId, stages.id))
    .where(where)
    .orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]))
    .limit(query.limit)
    .offset(query.offset);

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(companies)
    .where(where);

  return { items: await hydrate(ctx, session, rows.map((r) => r.company)), total };
}

export interface CreateDealResult extends DealDto {
  companyCreated: boolean;
}

export async function createDeal(
  ctx: CoreContext,
  session: Session,
  input: CreateDealInput,
): Promise<CreateDealResult> {
  let companyId = input.companyId;
  let companyCreated = false;

  if (!companyId && !input.companyName) {
    throw new CoreError("companyId or companyName required", { code: "missing_company" });
  }

  // normalize website → domain
  const rawDomain = (input.domain ?? input.website ?? "").trim();
  const normalizedDomain = rawDomain
    ? rawDomain
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/.*$/, "")
        .toLowerCase()
    : undefined;

  if (!companyId) {
    const existing = await findCompanyMatch(ctx, ctx.db, session.workspaceId, input.companyName!, normalizedDomain ?? null);
    if (existing) {
      companyId = existing.id;
    } else {
      const company = await createCompany(ctx, session, {
        name: input.companyName!,
        domain: normalizedDomain,
        description: input.description,
        sector: input.sector,
        location: input.location,
        linkedinUrl: input.linkedinUrl,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        ownerUserId: input.ownerUserId,
        roundStage: input.roundStage ?? undefined,
        askAmount: input.askAmount,
        valuation: input.valuation,
        priority: input.priority,
        nextStepAt: input.nextStepAt ?? undefined,
        sourceRef: input.sourceRef,
        fields: input.fields,
        tags: input.tags,
        mergeWithExisting: true,
      });
      companyId = company.id;
      companyCreated = true;
    }
  }

  if (!companyCreated) {
    const patch: UpdateDealInput = {
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.roundStage !== undefined ? { roundStage: input.roundStage } : {}),
      ...(input.askAmount !== undefined ? { askAmount: input.askAmount } : {}),
      ...(input.valuation !== undefined ? { valuation: input.valuation } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.nextStepAt !== undefined ? { nextStepAt: input.nextStepAt } : {}),
      ...(input.fields ? { fields: input.fields } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    };
    if (Object.keys(patch).length) {
      const dto = await updateDeal(ctx, session, companyId!, patch);
      return { ...dto, companyCreated };
    }
  }

  const dto = await getDeal(ctx, session, companyId!);
  return { ...dto, companyCreated };
}

export async function updateDeal(
  ctx: CoreContext,
  session: Session,
  dealId: string,
  patch: UpdateDealInput,
): Promise<DealDto> {
  return ctx.db.transaction(async (tx) => {
    const row0 = await getDealRow(ctx, tx, session.workspaceId, dealId);
    const { fields, archived, stageId, ownerUserId, nextStepAt, askAmount, valuation, title, ...rest } = patch;
    void rest;

    let stageChangedStageName: string | null = null;
    let position = undefined as string | undefined;
    let pipelineId = undefined as string | undefined;

    if (stageId && stageId !== row0.stageId) {
      const stage = await getStage(ctx, tx, session.workspaceId, stageId);
      position = await nextStagePosition(tx, stage.id);
      stageChangedStageName = stage.name;
      pipelineId = stage.pipelineId;
    }

    const [row] = await tx
      .update(companies)
      .set({
        ...(title ? { name: title } : {}),
        ...(stageId ? { stageId, ...(pipelineId ? { pipelineId } : {}) } : {}),
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
        ...(position ? { position } : {}),
        ...(askAmount !== undefined ? { askAmount: askAmount === null ? null : String(askAmount) } : {}),
        ...(valuation !== undefined ? { valuation: valuation === null ? null : String(valuation) } : {}),
        ...(patch.roundStage !== undefined ? { roundStage: patch.roundStage } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.tags ? { tags: patch.tags } : {}),
        ...(nextStepAt !== undefined
          ? { nextStepAt: nextStepAt === null ? null : new Date(nextStepAt) }
          : {}),
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(companies.id, dealId), eq(companies.workspaceId, session.workspaceId)))
      .returning();

    if (fields) {
      await setFieldValues(
        ctx,
        tx as unknown as Exec,
        session,
        "company",
        dealId,
        fields as Record<string, FieldValuePrimitive>,
      );
    }

    if (stageChangedStageName) {
      await logActivity(ctx, tx, {
        workspaceId: session.workspaceId,
        entityType: "deal",
        entityId: dealId,
        companyId: row.id,
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
        companyId: row.id,
        dealId,
        type: archived ? "deal.archived" : "deal.updated",
        summary: archived ? `Deal "${row.name}" archived` : `Deal "${row.name}" restored`,
        actor: session.actor.userId ? "user" : "system",
        actorUserId: session.actor.userId,
      });
    }

    return row.id;
  }).then((id) => getDeal(ctx, session, id));
}

/** Kanban drag-and-drop: place company before another (or append). */
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
      const [prev] = await tx
        .select({ position: companies.position })
        .from(companies)
        .where(
          and(
            eq(companies.stageId, targetStageId),
            sql`${companies.position} < ${before.position}`,
            sql`${companies.id} <> ${dealId}`,
          ),
        )
        .orderBy(desc(companies.position))
        .limit(1);
      afterPos = prev?.position ?? null;
      beforePos = before.position;
    } else {
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<string | null>`max(${companies.position})` })
        .from(companies)
        .where(and(eq(companies.stageId, targetStageId), isNull(companies.archivedAt)));
      afterPos = maxPos;
    }

    const position = generateKeyBetween(afterPos, beforePos);
    let pipelineId: string | undefined;
    if (targetStageId !== row0.stageId) {
      const stage = await getStage(ctx, tx, session.workspaceId, targetStageId);
      pipelineId = stage.pipelineId;
    }

    const [row] = await tx
      .update(companies)
      .set({
        stageId: targetStageId,
        ...(pipelineId ? { pipelineId } : {}),
        position,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, dealId))
      .returning();

    if (targetStageId !== row0.stageId) {
      const stage = await getStage(ctx, tx, session.workspaceId, targetStageId);
      await logActivity(ctx, tx, {
        workspaceId: session.workspaceId,
        entityType: "deal",
        entityId: dealId,
        companyId: row.id,
        dealId,
        type: "deal.stage_changed",
        summary: `Moved to ${stage.name}`,
        actor: session.actor.userId ? "user" : "system",
        actorUserId: session.actor.userId,
        data: { from: row0.stageId, to: targetStageId },
      });
    }

    return (await hydrate(ctx, session, [row]))[0]!;
  });
}
