import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { companies, conversations, stages } from "@copyr/db/schema.js";
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
    const closedTotal = wonCount.count + lostCount.count;
    conversionRate = closedTotal === 0 ? 0 : Math.round((wonCount.count / closedTotal) * 100);

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

  // weekly ingestion trend (last 8 weeks)
  const weeklyRows = await ctx.db
    .select({
      weekStart: sql<string>`date_trunc('week', ${companies.createdAt})::date::text`,
      deals: sql<number>`count(*)::int`,
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
