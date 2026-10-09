import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { companies, conversations, stages, users } from "@copyr/db/schema.js";
import type { AnalyticsOverview } from "@copyr/contracts";
import type { CoreContext, Session } from "../context.js";

function pct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export async function analyticsOverview(
  ctx: CoreContext,
  session: Session,
): Promise<AnalyticsOverview> {
  const ws = session.workspaceId;
  const now = Date.now();
  const days30 = new Date(now - 30 * 86_400_000);
  const days60 = new Date(now - 60 * 86_400_000);

  // active deals now vs 30d ago
  const [activeNow] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(and(eq(companies.workspaceId, ws), isNull(companies.archivedAt), sql`${companies.createdAt} <= now()`));
  const [activePrev] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, ws),
        isNull(companies.archivedAt),
        gte(companies.createdAt, days60),
        sql`${companies.createdAt} < ${days30.toISOString()}`,
      ),
    );

  // pipeline value: open deals only (exclude won/lost stages)
  const wonLostStages = await ctx.db
    .select({ id: stages.id })
    .from(stages)
    .where(and(eq(stages.workspaceId, ws), sql`${stages.kind} <> 'active'`));
  const wonLostIds = wonLostStages.map((s) => s.id);
  const openConds = [eq(companies.workspaceId, ws), isNull(companies.archivedAt)];
  if (wonLostIds.length) openConds.push(sql`${companies.stageId} not in ${wonLostIds}` as never);
  const [pipelineNow] = await ctx.db
    .select({ usd: sql<number | null>`sum(${companies.askAmount})::float8` })
    .from(companies)
    .where(and(...openConds));
  const [pipelinePrev] = await ctx.db
    .select({ usd: sql<number | null>`sum(${companies.askAmount})::float8` })
    .from(companies)
    .where(and(...openConds, sql`${companies.createdAt} < ${days30.toISOString()}`));

  // founders met in last 30d (contacts flagged founder created recently via companies)
  const [foundersNow] = await ctx.db
    .select({ count: sql<number>`count(distinct ${companies.id})::int` })
    .from(companies)
    .where(and(eq(companies.workspaceId, ws), gte(companies.createdAt, days30)));
  const [foundersPrev] = await ctx.db
    .select({ count: sql<number>`count(distinct ${companies.id})::int` })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, ws),
        gte(companies.createdAt, days60),
        sql`${companies.createdAt} < ${days30.toISOString()}`,
      ),
    );

  // conversion: deals that reached a 'won' stage / total closed (won+lost)
  const stageRows = await ctx.db
    .select()
    .from(stages)
    .where(eq(stages.workspaceId, ws));
  const wonIds = stageRows.filter((s) => s.kind === "won").map((s) => s.id);
  const lostIds = stageRows.filter((s) => s.kind === "lost").map((s) => s.id);
  let conversionRate = 0;
  let conversionDelta = 0;
  let wonTotal = 0;
  let lostTotal = 0;
  if (wonIds.length || lostIds.length) {
    const [wonCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, ws),
          wonIds.length ? inArray(companies.stageId, wonIds) : sql`false`,
        ),
      );
    const [lostCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, ws),
          lostIds.length ? inArray(companies.stageId, lostIds) : sql`false`,
        ),
      );
    wonTotal = wonCount.count;
    lostTotal = lostCount.count;
    const closedTotal = wonTotal + lostTotal;
    conversionRate = closedTotal === 0 ? 0 : Math.round((wonTotal / closedTotal) * 100);

    // prior-window conversion for the delta chip
    const [wonPrev] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, ws),
          gte(companies.updatedAt, days60),
          sql`${companies.updatedAt} < ${days30.toISOString()}`,
          wonIds.length ? inArray(companies.stageId, wonIds) : sql`false`,
        ),
      );
    const [lostPrev] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, ws),
          gte(companies.updatedAt, days60),
          sql`${companies.updatedAt} < ${days30.toISOString()}`,
          lostIds.length ? inArray(companies.stageId, lostIds) : sql`false`,
        ),
      );
    const prevClosed = wonPrev.count + lostPrev.count;
    const prevRate = prevClosed === 0 ? 0 : Math.round((wonPrev.count / prevClosed) * 100);
    conversionDelta =
      prevClosed === 0 && closedTotal === 0 ? 0 :
      prevClosed === 0 ? 100 : conversionRate - prevRate;
  }

  // per-stage breakdown
  const byStageRows = await ctx.db
    .select({
      stageId: stages.id,
      stageName: stages.name,
      color: stages.color,
      count: sql<number>`count(${companies.id})::int`,
      usd: sql<number>`coalesce(sum(${companies.askAmount}), 0)::float8`,
    })
    .from(stages)
    .leftJoin(companies, and(eq(companies.stageId, stages.id), isNull(companies.archivedAt)))
    .where(eq(stages.workspaceId, ws))
    .groupBy(stages.id, stages.name, stages.color, stages.position)
    .orderBy(asc(stages.position));

  const activeStageIds = stageRows.filter((s) => s.kind === "active").map((s) => s.id);
  const [openCount] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, ws),
        isNull(companies.archivedAt),
        activeStageIds.length ? inArray(companies.stageId, activeStageIds) : sql`false`,
      ),
    );

  const [asks] = await ctx.db
    .select({
      avg: sql<number | null>`avg(${companies.askAmount})::float8`,
      median: sql<number | null>`percentile_cont(0.5) within group (order by ${companies.askAmount}::float8)`,
    })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, ws),
        isNull(companies.archivedAt),
        sql`${companies.askAmount} is not null`,
      ),
    );

  const bySectorRows = await ctx.db
    .select({
      name: sql<string>`coalesce(nullif(${companies.sector}, ''), 'Unspecified')`,
      count: sql<number>`count(*)::int`,
      usd: sql<number>`coalesce(sum(${companies.askAmount}), 0)::float8`,
    })
    .from(companies)
    .where(and(eq(companies.workspaceId, ws), isNull(companies.archivedAt)))
    .groupBy(sql`coalesce(nullif(${companies.sector}, ''), 'Unspecified')`)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  const bySourceRows = await ctx.db
    .select({
      source: companies.source,
      count: sql<number>`count(*)::int`,
      usd: sql<number>`coalesce(sum(${companies.askAmount}), 0)::float8`,
    })
    .from(companies)
    .where(and(eq(companies.workspaceId, ws), isNull(companies.archivedAt)))
    .groupBy(companies.source)
    .orderBy(desc(sql`count(*)`));

  const byRoundRows = await ctx.db
    .select({
      round: sql<string>`coalesce(nullif(${companies.roundStage}, ''), 'Unspecified')`,
      count: sql<number>`count(*)::int`,
      usd: sql<number>`coalesce(sum(${companies.askAmount}), 0)::float8`,
    })
    .from(companies)
    .where(and(eq(companies.workspaceId, ws), isNull(companies.archivedAt)))
    .groupBy(sql`coalesce(nullif(${companies.roundStage}, ''), 'Unspecified')`)
    .orderBy(desc(sql`sum(${companies.askAmount})`))
    .limit(8);

  const byOwnerRows = await ctx.db
    .select({
      ownerId: companies.ownerUserId,
      name: sql<string>`coalesce(${users.name}, 'Unassigned')`,
      count: sql<number>`count(*)::int`,
      usd: sql<number>`coalesce(sum(${companies.askAmount}), 0)::float8`,
    })
    .from(companies)
    .leftJoin(users, eq(companies.ownerUserId, users.id))
    .where(and(eq(companies.workspaceId, ws), isNull(companies.archivedAt)))
    .groupBy(companies.ownerUserId, users.name)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  const largestRows = await ctx.db
    .select({
      id: companies.id,
      name: companies.name,
      sector: companies.sector,
      roundStage: companies.roundStage,
      askAmount: companies.askAmount,
      stageName: stages.name,
      stageColor: stages.color,
    })
    .from(companies)
    .innerJoin(stages, eq(companies.stageId, stages.id))
    .where(and(eq(companies.workspaceId, ws), isNull(companies.archivedAt)))
    .orderBy(sql`${companies.askAmount} desc nulls last`)
    .limit(8);

  // weekly ingestion trend (last 8 weeks)
  const weeklyRows = await ctx.db
    .select({
      weekStart: sql<string>`date_trunc('week', ${companies.createdAt})::date::text`,
      deals: sql<number>`count(*)::int`,
      usd: sql<number>`coalesce(sum(${companies.askAmount}), 0)::float8`,
    })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, ws),
        gte(companies.createdAt, new Date(now - 56 * 86_400_000)),
      ),
    )
    .groupBy(sql`date_trunc('week', ${companies.createdAt})`)
    .orderBy(sql`date_trunc('week', ${companies.createdAt})`);

  return {
    activeDeals: activeNow?.count ?? 0,
    activeDealsDeltaPct: pct(activeNow?.count ?? 0, activePrev?.count ?? 0),
    totalPipelineUsd: pipelineNow?.usd ?? 0,
    totalPipelineDeltaPct: pct(pipelineNow?.usd ?? 0, pipelinePrev?.usd ?? 0),
    newFounders30d: foundersNow?.count ?? 0,
    newFoundersDeltaPct: pct(foundersNow?.count ?? 0, foundersPrev?.count ?? 0),
    conversionRatePct: conversionRate,
    conversionDeltaPct: conversionDelta,
    openDeals: openCount?.count ?? 0,
    wonDeals: wonTotal,
    lostDeals: lostTotal,
    avgAskUsd: Number(asks?.avg ?? 0),
    medianAskUsd: Number(asks?.median ?? 0),
    byStage: byStageRows.map((r) => ({
      stageId: r.stageId,
      stageName: r.stageName,
      color: r.color,
      count: r.count,
      usd: r.usd ?? 0,
    })),
    weeklyIngestion: weeklyRows.map((r) => ({ ...r, usd: r.usd ?? 0 })),
    bySector: bySectorRows.map((r) => ({ name: r.name, count: r.count, usd: r.usd ?? 0 })),
    bySource: bySourceRows.map((r) => ({ source: r.source, count: r.count, usd: r.usd ?? 0 })),
    byRound: byRoundRows.map((r) => ({ round: r.round, count: r.count, usd: r.usd ?? 0 })),
    byOwner: byOwnerRows.map((r) => ({
      ownerId: r.ownerId,
      name: r.name,
      count: r.count,
      usd: r.usd ?? 0,
    })),
    largestDeals: largestRows.map((r) => ({
      id: r.id,
      name: r.name,
      sector: r.sector,
      roundStage: r.roundStage,
      askAmount: r.askAmount === null ? null : Number(r.askAmount),
      stageName: r.stageName,
      stageColor: r.stageColor,
    })),
  };
}

export async function globalSearch(
  ctx: CoreContext,
  session: Session,
  q: string,
  limit = 8,
): Promise<{
  companies: Array<{ id: string; name: string; sector: string | null; status: string }>;
  deals: Array<{ id: string; title: string; companyId: string; companyName: string; stageName: string | null }>;
  conversations: Array<{ id: string; title: string; lastMessageAt: string }>;
}> {
  const like = `%${q}%`;
  const companyRows = await ctx.db
    .select({ id: companies.id, name: companies.name, sector: companies.sector, status: companies.status })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, session.workspaceId),
        sql`(${companies.name} ilike ${like} or ${companies.domain} ilike ${like} or coalesce(${companies.sector},'') ilike ${like})`,
      ),
    )
    .limit(limit);

  const dealRows = await ctx.db
    .select({
      id: companies.id,
      title: companies.name,
      companyId: companies.id,
      companyName: companies.name,
      stageName: stages.name,
    })
    .from(companies)
    .leftJoin(stages, eq(companies.stageId, stages.id))
    .where(
      and(
        eq(companies.workspaceId, session.workspaceId),
        sql`(${companies.name} ilike ${like} or coalesce(${companies.roundStage},'') ilike ${like})`,
      ),
    )
    .limit(limit);

  const conversationRows = await ctx.db
    .select({ id: conversations.id, title: conversations.title, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, session.workspaceId), sql`${conversations.title} ilike ${like}`))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);

  return {
    companies: companyRows,
    deals: dealRows,
    conversations: conversationRows.map((c) => ({ ...c, lastMessageAt: c.lastMessageAt.toISOString() })),
  };
}
