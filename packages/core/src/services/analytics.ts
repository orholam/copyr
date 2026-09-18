import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { companies, conversations, deals, stages } from "@copyr/db/schema.js";
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
    .from(deals)
    .where(and(eq(deals.workspaceId, ws), isNull(deals.archivedAt), sql`${deals.createdAt} <= now()`));
  const [activePrev] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(deals)
    .where(
      and(
        eq(deals.workspaceId, ws),
        isNull(deals.archivedAt),
        gte(deals.createdAt, days60),
        sql`${deals.createdAt} < ${days30.toISOString()}`,
      ),
    );

  // pipeline value: open deals only (exclude won/lost stages)
  const wonLostStages = await ctx.db
    .select({ id: stages.id })
    .from(stages)
    .where(and(eq(stages.workspaceId, ws), sql`${stages.kind} <> 'active'`));
  const wonLostIds = wonLostStages.map((s) => s.id);
  const openConds = [eq(deals.workspaceId, ws), isNull(deals.archivedAt)];
  if (wonLostIds.length) openConds.push(sql`${deals.stageId} not in ${wonLostIds}` as never);
  const [pipelineNow] = await ctx.db
    .select({ usd: sql<number | null>`sum(${deals.askAmount})::float8` })
    .from(deals)
    .where(and(...openConds));
  const [pipelinePrev] = await ctx.db
    .select({ usd: sql<number | null>`sum(${deals.askAmount})::float8` })
    .from(deals)
    .where(and(...openConds, sql`${deals.createdAt} < ${days30.toISOString()}`));

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
  if (wonIds.length || lostIds.length) {
    const [wonCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, ws),
          wonIds.length ? inArray(deals.stageId, wonIds) : sql`false`,
        ),
      );
    const [lostCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, ws),
          lostIds.length ? inArray(deals.stageId, lostIds) : sql`false`,
        ),
      );
    const closedTotal = wonCount.count + lostCount.count;
    conversionRate = closedTotal === 0 ? 0 : Math.round((wonCount.count / closedTotal) * 100);

    // prior-window conversion for the delta chip
    const [wonPrev] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, ws),
          gte(deals.updatedAt, days60),
          sql`${deals.updatedAt} < ${days30.toISOString()}`,
          wonIds.length ? inArray(deals.stageId, wonIds) : sql`false`,
        ),
      );
    const [lostPrev] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, ws),
          gte(deals.updatedAt, days60),
          sql`${deals.updatedAt} < ${days30.toISOString()}`,
          lostIds.length ? inArray(deals.stageId, lostIds) : sql`false`,
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
      count: sql<number>`count(${deals.id})::int`,
      usd: sql<number>`coalesce(sum(${deals.askAmount}), 0)::float8`,
    })
    .from(stages)
    .leftJoin(deals, and(eq(deals.stageId, stages.id), isNull(deals.archivedAt)))
    .where(eq(stages.workspaceId, ws))
    .groupBy(stages.id, stages.name, stages.color, stages.position)
    .orderBy(asc(stages.position));

  // weekly ingestion trend (last 8 weeks)
  const weeklyRows = await ctx.db
    .select({
      weekStart: sql<string>`date_trunc('week', ${deals.createdAt})::date::text`,
      deals: sql<number>`count(*)::int`,
    })
    .from(deals)
    .where(
      and(
        eq(deals.workspaceId, ws),
        gte(deals.createdAt, new Date(now - 56 * 86_400_000)),
      ),
    )
    .groupBy(sql`date_trunc('week', ${deals.createdAt})`)
    .orderBy(sql`date_trunc('week', ${deals.createdAt})`);

  return {
    activeDeals: activeNow?.count ?? 0,
    activeDealsDeltaPct: pct(activeNow?.count ?? 0, activePrev?.count ?? 0),
    totalPipelineUsd: pipelineNow?.usd ?? 0,
    totalPipelineDeltaPct: pct(pipelineNow?.usd ?? 0, pipelinePrev?.usd ?? 0),
    newFounders30d: foundersNow?.count ?? 0,
    newFoundersDeltaPct: pct(foundersNow?.count ?? 0, foundersPrev?.count ?? 0),
    conversionRatePct: conversionRate,
    conversionDeltaPct: conversionDelta,
    byStage: byStageRows.map((r) => ({
      stageId: r.stageId,
      stageName: r.stageName,
      color: r.color,
      count: r.count,
      usd: r.usd ?? 0,
    })),
    weeklyIngestion: weeklyRows,
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
      id: deals.id,
      title: deals.title,
      companyId: companies.id,
      companyName: companies.name,
      stageName: stages.name,
    })
    .from(deals)
    .innerJoin(companies, eq(deals.companyId, companies.id))
    .leftJoin(stages, eq(deals.stageId, stages.id))
    .where(
      and(
        eq(deals.workspaceId, session.workspaceId),
        sql`(${deals.title} ilike ${like} or ${companies.name} ilike ${like})`,
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
