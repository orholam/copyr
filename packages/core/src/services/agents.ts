import { and, desc, eq, sql } from "drizzle-orm";
import {
  agentRuns,
  agents,
  companies,
  documents,
  notes,
  portfolioUpdates,
  workflows,
} from "@copyr/db/schema.js";
import type {
  AgentConfig,
  AgentDto,
  AgentRunDto,
  CreateAgentInput,
  RunAgentInput,
  UpdateAgentInput,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";

/* ── CRUD ──────────────────────────────────────────────────────────── */

export async function createAgent(
  ctx: CoreContext,
  session: Session,
  input: CreateAgentInput,
): Promise<AgentDto> {
  const [row] = await ctx.db
    .insert(agents)
    .values({
      workspaceId: session.workspaceId,
      name: input.name,
      kind: input.kind ?? "custom",
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      config: normalizeConfig(input.config),
      scheduleCron: input.scheduleCron ?? null,
      nextRunAt: input.scheduleCron ? nextCronRun() : null,
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "agent",
    entityId: row.id,
    type: "agent.created",
    summary: `Agent "${row.name}" (${row.kind}) created`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  return mapAgent(row);
}

/** Seed the standard system agents for a workspace (idempotent by name). */
export async function ensureSystemAgents(ctx: CoreContext, workspaceId: string): Promise<void> {
  const existing = await ctx.db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));
  const have = new Set(existing.map((e) => e.name));

  const wanted = [
    {
      name: "Thesis Screener",
      kind: "thesis_screen" as const,
      description:
        "Scores inbound companies against the fund thesis and recommends advance / watch / pass.",
      instructions:
        "Evaluate fit against the fund's stated focus. Weight team, market, traction, and defensibility.",
      config: {},
      isSystem: true,
    },
    {
      name: "Diligence Checklist Builder",
      kind: "diligence_checklist" as const,
      description:
        "Provisions a standard diligence checklist into a deal space so nothing is missed between first call and partner meeting.",
      instructions: null,
      config: {
        checklist: [
          "Customer reference calls — at least two current customers",
          "Technical architecture deep-dive with founding engineers",
          "Cap table review and option-pool check",
          "Competitive landscape map of direct and adjacent players",
          "Cohort retention analysis request to founders",
          "Employment agreements and IP assignment verification",
        ],
      },
      isSystem: true,
    },
    {
      name: "Portfolio Monitor",
      kind: "portfolio_monitor" as const,
      description:
        "Summarizes recent portfolio activity and flags companies that went quiet.",
      instructions: null,
      config: { watchItems: ["funding", "hiring", "metric milestones"] },
      isSystem: true,
    },
  ];

  for (const w of wanted) {
    if (have.has(w.name)) continue;
    await ctx.db.insert(agents).values({
      workspaceId,
      name: w.name,
      kind: w.kind,
      description: w.description,
      instructions: w.instructions,
      config: w.config,
      isSystem: w.isSystem,
      isActive: true,
    });
  }

  await ensureDefaultAgentWorkflows(ctx, workspaceId);
}

/**
 * Real VC use-case workflows every workspace gets out of the box
 * (idempotent by name — missing ones are added, existing names left alone).
 */
export const DEFAULT_WORKFLOW_SPECS: Array<{
  name: string;
  description: string;
  triggerEvent:
    | "company.created"
    | "agent_run.completed"
    | "deal.stage_changed"
    | "deal.created";
  conditions: Array<{ field: string; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "exists"; value?: unknown }>;
  actions: Array<{
    type: "add_note" | "move_deal" | "set_deal_fields" | "set_company_fields" | "create_portfolio_update" | "run_agent";
    config: Record<string, unknown>;
  }>;
  isEnabled: boolean;
}> = [
  {
    name: "Screen new companies",
    description: "When a company lands in the pipeline, run Thesis Screener for an advance / watch / pass call.",
    triggerEvent: "company.created",
    conditions: [],
    actions: [{ type: "run_agent", config: { agentName: "Thesis Screener" } }],
    isEnabled: true,
  },
  {
    name: "Promote advancing screens",
    description: "When Thesis Screener says advance, stamp High conviction, move to Initial Review, and brief the team.",
    triggerEvent: "agent_run.completed",
    conditions: [{ field: "output.recommendation", op: "eq", value: "advance" }],
    actions: [
      { type: "set_deal_fields", config: { fields: { conviction: "High" } } },
      { type: "move_deal", config: { stageName: "Initial Review" } },
      {
        type: "add_note",
        config: {
          body: "{{agent.name}} scored {{output.fitScore}}/100 (advance) on {{company.name}} — flagged for partner attention.",
        },
      },
    ],
    isEnabled: true,
  },
  {
    name: "File pass recommendations",
    description: "When Thesis Screener says pass, move the deal to Passed and leave a short rationale note.",
    triggerEvent: "agent_run.completed",
    conditions: [{ field: "output.recommendation", op: "eq", value: "pass" }],
    actions: [
      { type: "move_deal", config: { stageName: "Passed" } },
      {
        type: "add_note",
        config: {
          body: "{{agent.name}} recommended pass on {{company.name}} ({{output.fitScore}}/100). Auto-filed to Passed.",
        },
      },
    ],
    isEnabled: true,
  },
  {
    name: "Diligence kickoff",
    description: "When a deal enters Due Diligence, provision the standard checklist so nothing is missed.",
    triggerEvent: "deal.stage_changed",
    conditions: [{ field: "deal.stageName", op: "eq", value: "Due Diligence" }],
    actions: [
      { type: "run_agent", config: { agentName: "Diligence Checklist Builder" } },
    ],
    isEnabled: true,
  },
];

/**
 * Install the default use-case workflows (idempotent by workflow name).
 */
export async function ensureDefaultAgentWorkflows(
  ctx: CoreContext,
  workspaceId: string,
): Promise<void> {
  const existing = await ctx.db
    .select({ name: workflows.name })
    .from(workflows)
    .where(eq(workflows.workspaceId, workspaceId));
  const have = new Set(existing.map((e) => e.name));

  for (const spec of DEFAULT_WORKFLOW_SPECS) {
    if (have.has(spec.name)) continue;
    await ctx.db.insert(workflows).values({
      workspaceId,
      name: spec.name,
      description: spec.description,
      triggerEvent: spec.triggerEvent,
      conditions: spec.conditions,
      actions: spec.actions,
      isEnabled: spec.isEnabled,
    });
  }
}

export async function listAgents(ctx: CoreContext, session: Session): Promise<AgentDto[]> {
  const rows = await ctx.db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, session.workspaceId))
    .orderBy(desc(agents.isActive), agents.createdAt);
  return rows.map(mapAgent);
}

export async function getAgent(ctx: CoreContext, session: Session, agentId: string): Promise<AgentDto> {
  const row = await getAgentRow(ctx, session.workspaceId, agentId);
  return mapAgent(row);
}

export async function getAgentRow(ctx: CoreContext, workspaceId: string, agentId: string) {
  const [row] = await ctx.db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)));
  if (!row) throw new CoreError("agent not found", { status: 404 });
  return row;
}

export async function updateAgent(
  ctx: CoreContext,
  session: Session,
  agentId: string,
  patch: UpdateAgentInput,
): Promise<AgentDto> {
  await getAgentRow(ctx, session.workspaceId, agentId);
  const [row] = await ctx.db
    .update(agents)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions ?? null } : {}),
      ...(patch.config !== undefined ? { config: normalizeConfig(patch.config) } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.scheduleCron !== undefined
        ? {
            scheduleCron: patch.scheduleCron ?? null,
            nextRunAt: patch.scheduleCron ? nextCronRun() : null,
          }
        : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      version: sql`${agents.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, session.workspaceId)))
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "agent",
    entityId: agentId,
    type: "agent.updated",
    summary: `Agent "${row.name}" updated (v${row.version})`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  return mapAgent(row);
}

/* ── runs ──────────────────────────────────────────────────────────── */

export async function queueAgentRun(
  ctx: CoreContext,
  sessionOrWs: Session | { workspaceId: string },
  agentId: string,
  input: RunAgentInput & { taskId?: string; runInline?: boolean; __wfOriginWorkflowId?: string },
): Promise<{ run: AgentRunDto; jobId?: string }> {
  const session: Session =
    "actor" in sessionOrWs ? sessionOrWs : { workspaceId: sessionOrWs.workspaceId, actor: { userId: null, source: "api" } };
  const agent = await getAgentRow(ctx, session.workspaceId, agentId);
  if (!agent.isActive && input.trigger === "manual") {
    throw new CoreError("agent is not active", { code: "agent_inactive", status: 409 });
  }

  const [run] = await ctx.db
    .insert(agentRuns)
    .values({
      workspaceId: session.workspaceId,
      agentId,
      status: "queued",
      trigger: input.trigger ?? "manual",
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      spaceId: input.spaceId ?? null,
      taskId: input.taskId ?? null,
      input: input as Record<string, unknown>,
      steps: [{ step: "queued", status: "ok", at: new Date().toISOString() }],
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "agent_run",
    entityId: run.id,
    companyId: run.companyId,
    dealId: run.dealId,
    type: "agent_run.queued",
    summary: `Agent "${agent.name}" queued (${run.trigger})`,
    actor: session.actor?.userId ? "user" : "ai",
    actorUserId: session.actor?.userId ?? null,
  });

  if (input.runInline) {
    // used by seed/tests: execute synchronously
    const { executeAgentRun } = await import("../jobs/agentRunner.js");
    await executeAgentRun(ctx, session.workspaceId, run.id);
    const dto = await getRun(ctx, session.workspaceId, run.id);
    return { run: dto };
  }

  const jobId = await ctx.enqueue("run-agent", {
    workspaceId: session.workspaceId,
    runId: run.id,
  });
  // If pg-boss is down / disabled, do not leave the run stuck in `queued`.
  if (!jobId) {
    const { executeAgentRun } = await import("../jobs/agentRunner.js");
    await executeAgentRun(ctx, session.workspaceId, run.id);
    return { run: await getRun(ctx, session.workspaceId, run.id) };
  }
  return { run: mapRun(run, agent.name), jobId };
}

export async function listRuns(
  ctx: CoreContext,
  session: Session,
  filter: { agentId?: string; companyId?: string; status?: string; limit?: number; offset?: number },
): Promise<{ items: AgentRunDto[]; total: number }> {
  const conds = [eq(agentRuns.workspaceId, session.workspaceId)];
  if (filter.agentId) conds.push(eq(agentRuns.agentId, filter.agentId));
  if (filter.companyId) conds.push(eq(agentRuns.companyId, filter.companyId));
  if (filter.status) conds.push(eq(agentRuns.status, filter.status as never));
  const where = and(...conds);

  const rows = await ctx.db
    .select({ run: agentRuns, agentName: agents.name })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(where)
    .orderBy(desc(agentRuns.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(where);

  return { items: rows.map((r) => mapRun(r.run, r.agentName)), total };
}

export async function getRun(ctx: CoreContext, workspaceId: string, runId: string): Promise<AgentRunDto> {
  const [row] = await ctx.db
    .select({ run: agentRuns, agentName: agents.name })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)));
  if (!row) throw new CoreError("agent run not found", { status: 404 });
  return mapRun(row.run, row.agentName);
}

/**
 * Gather the full company context an agent reasons over — the Space mechanic:
 * the run opens inside the matter with documents, history and metrics attached.
 */
export async function gatherCompanyContext(
  ctx: CoreContext,
  workspaceId: string,
  companyId: string,
): Promise<{ companyName: string; sector: string | null; roundStage: string | null; askAmount: number | null; text: string }> {
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, companyId));
  if (!company || company.workspaceId !== workspaceId) {
    throw new CoreError("company not found", { status: 404 });
  }

  const deal = company;

  const docs = await ctx.db
    .select({ name: documents.name, textContent: documents.textContent })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.parseStatus, "parsed")))
    .orderBy(desc(documents.createdAt))
    .limit(6);

  const noteRows = await ctx.db
    .select({ body: notes.body })
    .from(notes)
    .where(eq(notes.companyId, companyId))
    .orderBy(desc(notes.createdAt))
    .limit(5);

  const updates = await ctx.db
    .select({ title: portfolioUpdates.title, body: portfolioUpdates.body })
    .from(portfolioUpdates)
    .where(eq(portfolioUpdates.companyId, companyId))
    .orderBy(desc(portfolioUpdates.occurredAt))
    .limit(5);

  const text = [
    `Company: ${company.name}`,
    company.description ? `Description: ${company.description}` : "",
    company.sector ? `Sector: ${company.sector}` : "",
    deal?.roundStage ? `Round: ${deal.roundStage}` : "",
    deal?.askAmount ? `Ask: $${Number(deal.askAmount).toLocaleString()}` : "",
    "",
    ...docs.flatMap((d) => [`[Document: ${d.name}]`, (d.textContent ?? "").slice(0, 3_500)]),
    ...noteRows.map((n) => `[Note] ${n.body.slice(0, 800)}`),
    ...updates.map((u) => `[Update] ${u.title}${u.body ? ` — ${u.body.slice(0, 400)}` : ""}`),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 24_000);

  return {
    companyName: company.name,
    sector: company.sector,
    roundStage: deal?.roundStage ?? null,
    askAmount: deal?.askAmount ? Number(deal.askAmount) : null,
    text,
  };
}

/* ── helpers ───────────────────────────────────────────────────────── */

function normalizeConfig(config?: Partial<AgentConfig>): AgentConfig {
  return {
    mustHaveKeywords: config?.mustHaveKeywords ?? [],
    excludeKeywords: config?.excludeKeywords ?? [],
    checklist: config?.checklist ?? [],
    watchItems: config?.watchItems ?? [],
  };
}

/** Coarse next-run estimate for display; the scheduler tick drives actual runs. */
function nextCronRun(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

type AgentRow = typeof agents.$inferSelect;
type RunRow = typeof agentRuns.$inferSelect;

function mapAgent(row: AgentRow): AgentDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    instructions: row.instructions,
    config: normalizeConfig(row.config ?? undefined),
    scheduleCron: row.scheduleCron,
    nextRunAt: toIso(row.nextRunAt),
    isActive: row.isActive,
    isSystem: row.isSystem,
    version: row.version,
    runCount: row.runCount,
    lastRunAt: toIso(row.lastRunAt),
    createdAt: toIso(row.createdAt)!,
  };
}

function mapRun(row: RunRow, agentName?: string): AgentRunDto {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: agentName ?? undefined,
    status: row.status,
    trigger: row.trigger,
    companyId: row.companyId,
    companyName: undefined,
    dealId: row.dealId,
    taskId: row.taskId,
    input: (row.input as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown> | null) ?? null,
    steps: (row.steps ?? []).map((s) => ({ ...s, at: String(s.at) })),
    creditsUsed: row.creditsUsed,
    error: row.error,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdAt: toIso(row.createdAt)!,
  };
}
