import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

/**
 * Starter thesis for a new workspace. The screener reads this text directly —
 * it is the thesis, not a pointer to one stored somewhere else.
 */
const STARTER_THESIS = `Replace this with what the fund actually invests in. The screener scores every company against this text.

Advance when:
- The company matches the sectors, stage, and geography you care about.
- The team and the technology look strong enough for a first meeting.

Watch when:
- The idea is close but the materials are thin, or the moat and market are still unclear.

Pass when:
- The company is outside the sectors, stage, or business model you will not do.

Weight team, market, traction, and how defensible the product is.`;

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
        "The firm's thesis lives here. Scores each inbound company against that thesis and recommends advance, watch, or pass.",
      instructions: STARTER_THESIS,
      config: {},
      isSystem: true,
    },
    {
      name: "Website Enricher",
      kind: "custom" as const,
      description:
        "Researches the company with Parallel and fills gaps (description, sector, location, founding year, headcount) before screening.",
      instructions:
        "Research the company from public sources via Parallel. Write only missing values. Never clobber human input.",
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

  const enricherCopy = wanted.find((w) => w.name === "Website Enricher");
  if (enricherCopy && have.has(enricherCopy.name)) {
    await ctx.db
      .update(agents)
      .set({ description: enricherCopy.description, instructions: enricherCopy.instructions })
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, enricherCopy.name)));
  }

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
    | "deal.created"
    | "extraction.completed"
    | "document.parsed"
    | "company.updated";
  conditions: Array<{ field: string; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "exists" | "nexists"; value?: unknown }>;
  actions: Array<{
    type: "add_note" | "move_deal" | "set_deal_fields" | "set_company_fields" | "create_portfolio_update" | "run_agent";
    config: Record<string, unknown>;
  }>;
  isEnabled: boolean;
}> = [
  {
    name: "Enrich new companies",
    description: "When a company lands in the pipeline with a website, research it with Parallel before screening.",
    triggerEvent: "company.created",
    conditions: [{ field: "company.domain", op: "exists" }],
    actions: [{ type: "run_agent", config: { agentName: "Website Enricher" } }],
    isEnabled: true,
  },
  {
    name: "Screen new companies",
    description:
      "When a company lands without a website, screen immediately. Companies with a domain are enriched first, then screened by “Screen after enrichment”.",
    triggerEvent: "company.created",
    conditions: [{ field: "company.domain", op: "nexists" }],
    actions: [{ type: "run_agent", config: { agentName: "Thesis Screener" } }],
    isEnabled: true,
  },
  {
    name: "Screen after enrichment",
    description: "After the Website Enricher actually fills something in, screen with that context. A skip does not screen.",
    triggerEvent: "agent_run.completed",
    conditions: [
      { field: "agent.name", op: "eq", value: "Website Enricher" },
      { field: "output.enriched", op: "eq", value: true },
    ],
    actions: [{ type: "run_agent", config: { agentName: "Thesis Screener" } }],
    isEnabled: true,
  },
  {
    name: "Re-screen after deck content arrives",
    description: "When a deck is extracted, re-screen the company with the new material.",
    triggerEvent: "extraction.completed",
    conditions: [],
    actions: [{ type: "run_agent", config: { agentName: "Thesis Screener" } }],
    isEnabled: true,
  },
  {
    name: "Promote advancing screens",
    description: "When Thesis Screener says advance, stamp High conviction, move to Initial Review, and brief the team.",
    triggerEvent: "agent_run.completed",
    conditions: [
      { field: "agent.name", op: "eq", value: "Thesis Screener" },
      { field: "output.recommendation", op: "eq", value: "advance" },
    ],
    actions: [
      { type: "set_deal_fields", config: { fields: { conviction: "High" } } },
      { type: "move_deal", config: { stageName: "Initial Review" } },
    ],
    isEnabled: true,
  },
  {
    name: "File pass recommendations",
    description: "When Thesis Screener says pass, move the deal to Passed and leave a short rationale note.",
    triggerEvent: "agent_run.completed",
    conditions: [
      { field: "agent.name", op: "eq", value: "Thesis Screener" },
      { field: "output.recommendation", op: "eq", value: "pass" },
    ],
    actions: [{ type: "move_deal", config: { stageName: "Passed" } }],
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
    .select()
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

  const enrichNew = existing.find((w) => w.name === "Enrich new companies");
  if (enrichNew?.description?.includes("fetch")) {
    await ctx.db
      .update(workflows)
      .set({ description: "When a company lands in the pipeline with a website, research it with Parallel before screening." })
      .where(eq(workflows.id, enrichNew.id));
  }

  // Heal older “Screen new companies” rules that double-fired alongside enrichment.
  const screenNew = existing.find((w) => w.name === "Screen new companies");
  if (screenNew) {
    const conds = screenNew.conditions ?? [];
    const alreadyGated = conds.some(
      (c) => c.field === "company.domain" && (c.op === "nexists" || c.op === "eq"),
    );
    if (!alreadyGated) {
      await ctx.db
        .update(workflows)
        .set({
          conditions: [{ field: "company.domain", op: "nexists" }],
          description:
            "When a company lands without a website, screen immediately. Companies with a domain are enriched first, then screened by “Screen after enrichment”.",
        })
        .where(eq(workflows.id, screenNew.id));
    }
  }

  // A skipped enricher used to complete successfully and re-trigger screening.
  const screenAfter = existing.find((w) => w.name === "Screen after enrichment");
  if (screenAfter) {
    const conds = screenAfter.conditions ?? [];
    const requiresEnrichment = conds.some((c) => c.field === "output.enriched");
    if (!requiresEnrichment) {
      await ctx.db
        .update(workflows)
        .set({
          conditions: [...conds, { field: "output.enriched", op: "eq", value: true }],
          description:
            "After the Website Enricher actually fills something in, screen with that context. A skip does not screen.",
        })
        .where(eq(workflows.id, screenAfter.id));
    }
  }

  // Identical default names from older seeds each fired on the same event.
  const seenNames = new Set<string>();
  for (const row of existing) {
    if (!DEFAULT_WORKFLOW_SPECS.some((s) => s.name === row.name)) continue;
    if (seenNames.has(row.name)) {
      await ctx.db.update(workflows).set({ isEnabled: false }).where(eq(workflows.id, row.id));
      continue;
    }
    seenNames.add(row.name);
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
): Promise<{ run: AgentRunDto; jobId?: string; alreadyQueued?: boolean }> {
  const session: Session =
    "actor" in sessionOrWs ? sessionOrWs : { workspaceId: sessionOrWs.workspaceId, actor: { userId: null, source: "api" } };
  const agent = await getAgentRow(ctx, session.workspaceId, agentId);
  if (!agent.isActive && input.trigger === "manual") {
    throw new CoreError("agent is not active", { code: "agent_inactive", status: 409 });
  }

  const created = await ctx.db.transaction(async (tx) => {
    if (input.companyId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`agent-run:${agentId}:${input.companyId}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.agentId, agentId),
            eq(agentRuns.companyId, input.companyId),
            eq(agentRuns.workspaceId, session.workspaceId),
            inArray(agentRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (existing) return { row: existing, reused: true as const };
    }

    const [row] = await tx
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
    return { row: row!, reused: false as const };
  });

  const run = created.row;
  if (created.reused) {
    return { run: mapRun(run, agent.name), alreadyQueued: true };
  }

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
    data: { timeline: "hidden" },
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
    .select({ run: agentRuns, agentName: agents.name, companyName: companies.name })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .leftJoin(companies, eq(companies.id, agentRuns.companyId))
    .where(where)
    .orderBy(desc(agentRuns.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(where);

  return { items: rows.map((r) => mapRun(r.run, r.agentName, r.companyName)), total };
}

export async function getRun(ctx: CoreContext, workspaceId: string, runId: string): Promise<AgentRunDto> {
  const [row] = await ctx.db
    .select({ run: agentRuns, agentName: agents.name, companyName: companies.name })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .leftJoin(companies, eq(companies.id, agentRuns.companyId))
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)));
  if (!row) throw new CoreError("agent run not found", { status: 404 });
  return mapRun(row.run, row.agentName, row.companyName);
}

/**
 * Gather the full company context an agent reasons over — the Space mechanic:
 * the run opens inside the matter with documents, history and metrics attached.
 */
export async function gatherCompanyContext(
  ctx: CoreContext,
  workspaceId: string,
  companyId: string,
): Promise<{
  companyName: string;
  sector: string | null;
  roundStage: string | null;
  askAmount: number | null;
  domain: string | null;
  description: string | null;
  documentChars: number;
  text: string;
}> {
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
    domain: company.domain,
    description: company.description,
    documentChars: docs.reduce((n, d) => n + (d.textContent?.length ?? 0), 0),
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

function mapRun(row: RunRow, agentName?: string, companyName?: string | null): AgentRunDto {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: agentName ?? undefined,
    status: row.status,
    trigger: row.trigger,
    companyId: row.companyId,
    companyName: companyName ?? undefined,
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
