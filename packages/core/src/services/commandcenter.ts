import { sql } from "drizzle-orm";
import type { CoreContext, Session } from "../context.js";

/**
 * Command Center — the intelligence layer for the deployment itself:
 * adoption analytics across every product surface, credit economics,
 * peer benchmarking against all other workspaces on this deployment,
 * and rule-based recommendations for what to enable next.
 */
export interface CommandCenterReport {
  adoption: {
    deals: number;
    companies: number;
    documentsParsed: number;
    vaults: number;
    reviewTables: number;
    reviewRowsExtracted: number;
    activeAgents: number;
    agentRunsCompleted: number;
    agentRunsFailed: number;
    scheduledAgents: number;
    spaces: number;
    openTasks: number;
    memories: number;
    researchReports: number;
  };
  activity30d: {
    total: number;
    byActor: { user: number; ai: number; system: number };
    /** share of events produced by AI vs humans — the leverage ratio */
    aiLeveragePct: number;
    topEventTypes: Array<{ type: string; count: number }>;
  };
  credits30d: {
    spent: number;
    granted: number;
    balance: number;
    byReason: Array<{ reason: string; amount: number }>;
  };
  benchmark: {
    workspaceCount: number;
    dealsPercentile: number;
    documentsPercentile: number;
    pctWorkspacesUsingVaults: number;
    pctWorkspacesUsingAgents: number;
    pctWorkspacesUsingResearch: number;
    thisWorkspaceUses: string[];
  };
  recommendations: string[];
}

export async function commandCenter(
  ctx: CoreContext,
  session: Session,
): Promise<CommandCenterReport> {
  const ws = session.workspaceId;

  const counts = (
    await ctx.db.execute(sql`
      select
        (select count(*)::int from deals where workspace_id = ${ws} and archived_at is null) as deals,
        (select count(*)::int from companies where workspace_id = ${ws}) as companies,
        (select count(*)::int from documents where workspace_id = ${ws} and parse_status = 'parsed') as documents_parsed,
        (select count(*)::int from vaults where workspace_id = ${ws}) as vaults,
        (select count(*)::int from review_tables where workspace_id = ${ws}) as review_tables,
        (select count(*)::int from review_rows where workspace_id = ${ws}) as review_rows,
        (select count(*)::int from agents where workspace_id = ${ws} and is_active) as agents_active,
        (select count(*)::int from agents where workspace_id = ${ws} and is_active and schedule_cron is not null) as agents_scheduled,
        (select count(*)::int from agent_runs where workspace_id = ${ws} and status = 'completed') as runs_completed,
        (select count(*)::int from agent_runs where workspace_id = ${ws} and status = 'failed') as runs_failed,
        (select count(*)::int from spaces where workspace_id = ${ws} and archived_at is null) as spaces,
        (select count(*)::int from tasks where workspace_id = ${ws} and status != 'done') as tasks_open,
        (select count(*)::int from memories where workspace_id = ${ws}) as memories,
        (select count(*)::int from research_reports where workspace_id = ${ws}) as research_reports`)
  ).rows[0] as Record<string, number>;

  const activityRows = (
    await ctx.db.execute(sql`
      select actor::text as actor, count(*)::int as count
      from activities
      where workspace_id = ${ws} and created_at > now() - interval '30 days'
      group by actor`)
  ).rows as Array<{ actor: string; count: number }>;

  const eventTypeRows = (
    await ctx.db.execute(sql`
      select split_part(type, '.', 1) || '.' || split_part(type, '.', 2) as type, count(*)::int as count
      from activities
      where workspace_id = ${ws} and created_at > now() - interval '30 days'
      group by 1 order by count desc limit 8`)
  ).rows as Array<{ type: string; count: number }>;

  const creditRows = (
    await ctx.db.execute(sql`
      select reason::text as reason,
             sum(case when delta < 0 then -delta else 0 end)::int as spent,
             sum(case when delta > 0 then delta else 0 end)::int as granted
      from credit_ledger
      where workspace_id = ${ws} and created_at > now() - interval '30 days'
      group by reason order by spent desc`)
  ).rows as Array<{ reason: string; spent: number; granted: number }>;

  const [balanceRow] = (
    await ctx.db.execute(sql`select ai_credits_balance::int as balance from workspaces where id = ${ws}`)
  ).rows as Array<{ balance: number }>;

  // ── cross-workspace peer benchmarking (anonymized aggregates) ──────
  const dealCountsPerWs = (
    await ctx.db.execute(sql`select workspace_id, count(*)::int as n from deals group by 1`)
  ).rows as Array<{ workspace_id: string; n: number }>;
  const docCountsPerWs = (
    await ctx.db.execute(sql`select workspace_id, count(*)::int as n from documents where parse_status = 'parsed' group by 1`)
  ).rows as Array<{ workspace_id: string; n: number }>;

  const thisDeals = Number(counts.deals ?? 0);
  const thisDocs = Number(counts.documents_parsed ?? 0);
  const dealsPercentile = percentileRank(dealCountsPerWs.map((r) => r.n).filter((n) => n > 0), thisDeals);
  const docsPercentile = percentileRank(docCountsPerWs.map((r) => r.n).filter((n) => n > 0), thisDocs);

  const wsCount = Math.max(1, new Set([...dealCountsPerWs.map((r) => r.workspace_id)]).size);

  const vaultAdoption = (
    await ctx.db.execute(sql`
      select round(100.0 * count(*) / greatest((select count(*)::int from workspaces), 1))::int as pct
      from (select distinct workspace_id from vaults) v`)
  ).rows[0] as { pct: number };
  const agentAdoption = (
    await ctx.db.execute(sql`
      select round(100.0 * count(*) / greatest((select count(*)::int from workspaces), 1))::int as pct
      from (select distinct workspace_id from agents) a`)
  ).rows[0] as { pct: number };
  const researchAdoption = (
    await ctx.db.execute(sql`
      select round(100.0 * count(*) / greatest((select count(*)::int from workspaces), 1))::int as pct
      from (select distinct workspace_id from research_reports) r`)
  ).rows[0] as { pct: number };

  // ── assemble ────────────────────────────────────────────────────────
  const userEvents = sumBy(activityRows.filter((a) => a.actor === "user"), (a) => a.count);
  const aiEvents = sumBy(activityRows.filter((a) => a.actor === "ai"), (a) => a.count);
  const systemEvents = sumBy(activityRows.filter((a) => a.actor === "system"), (a) => a.count);
  const totalEvents = userEvents + aiEvents + systemEvents;

  const thisWorkspaceUses: string[] = [];
  if (Number(counts.vaults) > 0) thisWorkspaceUses.push("vaults");
  if (Number(counts.agents_active) > 0) thisWorkspaceUses.push("agents");
  if (Number(counts.research_reports) > 0) thisWorkspaceUses.push("research");
  if (Number(counts.memories) > 0) thisWorkspaceUses.push("memory");

  const recommendations: string[] = [];
  if (Number(counts.vaults) === 0 && thisDocs > 3) {
    recommendations.push(
      `You have ${thisDocs} parsed documents but no diligence vault — create one over your hottest deal and run a review table across it.`,
    );
  }
  if (Number(counts.reviewTables) === 0 && Number(counts.vaults) > 0) {
    recommendations.push("Your vault has no review tables yet — extract structured diligence data (customer terms, change-of-control, IP assignments) in one query.");
  }
  if (Number(counts.memories) < 3) {
    recommendations.push("Record your fund's screening preferences in Memory so every answer and screen reflects them.");
  }
  if (Number(counts.research_reports) === 0) {
    recommendations.push("Try grounded research: ask a question over your corpus and get a cited answer instead of re-reading documents.");
  }
  if (Number(counts.agents_active) === 0) {
    recommendations.push("Activate the Thesis Screener to codify your fund judgment and let it triage new inbound deals automatically.");
  }
  if (Number(counts.spaces) === 0 && Number(counts.deals) > 5) {
    recommendations.push("Open a Space for your most active deal so context, tasks and agent work live in one place.");
  }
  if (!recommendations.length) {
    recommendations.push("Your deployment is firing on every surface. Consider scheduling the Portfolio Monitor weekly for standing coverage.");
  }

  return {
    adoption: {
      deals: Number(counts.deals ?? 0),
      companies: Number(counts.companies ?? 0),
      documentsParsed: thisDocs,
      vaults: Number(counts.vaults ?? 0),
      reviewTables: Number(counts.review_tables ?? 0),
      reviewRowsExtracted: Number(counts.review_rows ?? 0),
      activeAgents: Number(counts.agents_active ?? 0),
      agentRunsCompleted: Number(counts.runs_completed ?? 0),
      agentRunsFailed: Number(counts.runs_failed ?? 0),
      scheduledAgents: Number(counts.agents_scheduled ?? 0),
      spaces: Number(counts.spaces ?? 0),
      openTasks: Number(counts.tasks_open ?? 0),
      memories: Number(counts.memories ?? 0),
      researchReports: Number(counts.research_reports ?? 0),
    },
    activity30d: {
      total: totalEvents,
      byActor: { user: userEvents, ai: aiEvents, system: systemEvents },
      aiLeveragePct: totalEvents ? Math.round((aiEvents / totalEvents) * 100) : 0,
      topEventTypes: eventTypeRows,
    },
    credits30d: {
      spent: sumBy(creditRows, (c) => c.spent ?? 0),
      granted: sumBy(creditRows, (c) => c.granted ?? 0),
      balance: balanceRow?.balance ?? 0,
      byReason: creditRows.map((c) => ({ reason: c.reason, amount: c.spent ?? 0 })),
    },
    benchmark: {
      workspaceCount: wsCount,
      dealsPercentile,
      documentsPercentile: docsPercentile,
      pctWorkspacesUsingVaults: vaultAdoption?.pct ?? 0,
      pctWorkspacesUsingAgents: agentAdoption?.pct ?? 0,
      pctWorkspacesUsingResearch: researchAdoption?.pct ?? 0,
      thisWorkspaceUses,
    },
    recommendations,
  };
}

/* ── helpers ───────────────────────────────────────────────────────── */

function sumBy<T>(arr: T[], fn: (t: T) => number): number {
  return arr.reduce((acc, t) => acc + (fn(t) || 0), 0);
}

/** Percentile of `value` within `population` (0-100). */
function percentileRank(population: number[], value: number): number {
  if (!population.length) return 50;
  const below = population.filter((n) => n <= value).length;
  return Math.round((below / population.length) * 100);
}
