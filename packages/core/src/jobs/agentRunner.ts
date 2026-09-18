import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  agentRuns,
  agents,
  companies,
  deals,
  notes,
  spaces,
  tasks,
} from "@copyr/db/schema.js";
import type { CoreContext } from "../context.js";
import { logActivity } from "../activity.js";
import { spendCredits } from "../credits.js";
import { gatherCompanyContext } from "../services/agents.js";
import { generateKeyBetween } from "../fractional.js";

/**
 * Executes a queued agent run end-to-end: gathers the company context
 * (documents, notes, updates — the "Space" mechanic), reasons with the AI
 * provider against the agent's codified instructions, writes structured
 * output, and routes follow-up work (tasks/notes) back into the space.
 */
export async function executeAgentRun(
  ctx: CoreContext,
  workspaceId: string,
  runId: string,
): Promise<void> {
  const [run] = await ctx.db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)));
  if (!run || run.status === "running" || run.status === "completed") return;

  const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, run.agentId));
  if (!agent) return;

  const steps: Array<{ step: string; status: string; detail?: string; at: string }> = [
    ...(run.steps ?? []),
    { step: "started", status: "ok", at: now() },
  ];
  await ctx.db
    .update(agentRuns)
    .set({ status: "running", startedAt: new Date(), steps })
    .where(eq(agentRuns.id, run.id));

  const companyId = run.companyId ?? (await resolveCompanyId(ctx, run));

  try {
    let output: Record<string, unknown> = {};

    // ── thesis_screen ────────────────────────────────────────────────
    if (agent.kind === "thesis_screen") {
      steps.push({ step: "gather_context", status: "running", at: now() });
      if (!companyId) throw new Error("thesis_screen requires a company scope");
      const context = await gatherCompanyContext(ctx, workspaceId, companyId);

      steps.push({ step: "score_thesis", status: "running", at: now() });
      const score = await ctx.ai.scoreThesis({
        agentName: agent.name,
        instructions: agent.instructions,
        mustHaveKeywords: agent.config?.mustHaveKeywords ?? [],
        excludeKeywords: agent.config?.excludeKeywords ?? [],
        companyName: context.companyName,
        sector: context.sector,
        roundStage: context.roundStage,
        askAmount: context.askAmount,
        sourceText: context.text,
      });
      output = score as unknown as Record<string, unknown>;

      await ctx.db.transaction(async (tx) => {
        await spendCredits(ctx, tx as never, workspaceId, "agent_run", {
          refType: "agent_run",
          refId: run.id,
        });
      });

      steps.push({
        step: "scored",
        status: "ok",
        detail: `fit ${score.fitScore} → ${score.recommendation}`,
        at: now(),
      });

      // write a screening note on the company so the pipeline carries the result
      const noteBody =
        `**${agent.name}** — fit ${score.fitScore}/100 → ${score.recommendation.toUpperCase()}\n\n` +
        `${score.summary}\n` +
        (score.reasons.length ? `\nReasons:\n${score.reasons.map((r) => `- ${r}`).join("\n")}` : "") +
        (score.concerns.length ? `\nConcerns:\n${score.concerns.map((c) => `- ${c}`).join("\n")}` : "");
      await ctx.db.insert(notes).values({
        workspaceId,
        companyId,
        body: noteBody.slice(0, 4000),
        authorUserId: null,
      });

      steps.push({ step: "screening_note_written", status: "ok", at: now() });
    }

    // ── diligence_checklist ──────────────────────────────────────────
    else if (agent.kind === "diligence_checklist") {
      const items = agent.config?.checklist?.length
        ? agent.config.checklist
        : [
            "Customer reference calls",
            "Technical deep-dive",
            "Cap table review",
            "Competitive landscape map",
            "Retention analysis",
          ];

      // target space: provided space or the company's primary space
      let spaceId = run.spaceId;
      if (!spaceId && companyId) {
        const [existing] = await ctx.db
          .select({ id: spaces.id })
          .from(spaces)
          .where(
            and(
              eq(spaces.workspaceId, workspaceId),
              eq(spaces.companyId, companyId),
              isNull(spaces.archivedAt),
            ),
          )
          .orderBy(desc(spaces.createdAt))
          .limit(1);
        spaceId = existing?.id;
        if (!spaceId) {
          const [created] = await ctx.db
            .insert(spaces)
            .values({
              workspaceId,
              name: `Diligence — ${await companyName(ctx, companyId)}`,
              summary: `Auto-provisioned diligence space by ${agent.name}.`,
              companyId,
              dealId: run.dealId ?? null,
              isShared: false,
            })
            .returning();
          spaceId = created!.id;
        }
      }

      const [{ maxPos }] = await ctx.db
        .select({ maxPos: sql<string | null>`max(${tasks.position})` })
        .from(tasks)
        .where(spaceId ? eq(tasks.spaceId, spaceId) : sql`false`);
      let prev: string | null = maxPos ?? null;

      const createdTasks: Array<{ taskId: string; title: string }> = [];
      for (const item of items) {
        const position = generateKeyBetween(prev, null);
        const [task] = await ctx.db
          .insert(tasks)
          .values({
            workspaceId,
            spaceId: spaceId ?? null,
            companyId: companyId ?? null,
            dealId: run.dealId ?? null,
            title: item,
            status: "open",
            position,
          })
          .returning();
        createdTasks.push({ taskId: task.id, title: item });
        prev = position;
      }

      output = { createdTasks, spaceId };
      steps.push({
        step: "checklist_provisioned",
        status: "ok",
        detail: `${items.length} task(s)`,
        at: now(),
      });
    }

    // ── portfolio_monitor ────────────────────────────────────────────
    else if (agent.kind === "portfolio_monitor") {
      const watchItems = agent.config?.watchItems ?? [];
      const updates = await ctx.db.execute(sql`
        select pu.title, pu.kind, pu.occurred_at::text as occurred_at, c.name as company_name
        from portfolio_updates pu join companies c on c.id = pu.company_id
        where pu.workspace_id = ${workspaceId}
          and pu.occurred_at > now() - interval '14 days'
        order by pu.occurred_at desc limit 40`);

      const rows = updates.rows as Array<{
        title: string;
        kind: string;
        occurred_at: string;
        company_name: string;
      }>;
      const quietCompanies = (
        await ctx.db.execute(sql`
          select c.name from companies c
          where c.workspace_id = ${workspaceId} and c.status = 'portfolio'
            and not exists (
              select 1 from portfolio_updates pu
              where pu.company_id = c.id and pu.occurred_at > now() - interval '45 days'
            )
          limit 10`)
      ).rows as Array<{ name: string }>;

      const highlights = rows.map((r) => `[${r.kind}] ${r.company_name}: ${r.title}`);
      output = {
        highlights,
        quietCompanies: quietCompanies.map((q) => q.name),
        watchItems,
        summary:
          `${rows.length} portfolio event(s) in the last 14 days; ` +
          `${quietCompanies.length} company(ies) quiet for 45+ days.`,
      };

      steps.push({
        step: "monitor_scan",
        status: "ok",
        detail: String(output.summary),
        at: now(),
      });
    }

    // ── custom ───────────────────────────────────────────────────────
    else {
      // custom agents fall back to thesis-style screening when scoped to a
      // company, otherwise they record that they need a scope to act on.
      if (companyId) {
        const context = await gatherCompanyContext(ctx, workspaceId, companyId);
        const score = await ctx.ai.scoreThesis({
          agentName: agent.name,
          instructions: agent.instructions,
          mustHaveKeywords: agent.config?.mustHaveKeywords ?? [],
          excludeKeywords: agent.config?.excludeKeywords ?? [],
          companyName: context.companyName,
          sector: context.sector,
          roundStage: context.roundStage,
          askAmount: context.askAmount,
          sourceText: context.text,
        });
        output = score as unknown as Record<string, unknown>;
      } else {
        output = {
          summary: `Agent "${agent.name}" has no company scope; provide companyId/dealId to execute.`,
        };
      }
      steps.push({ step: "custom_executed", status: "ok", at: now() });
    }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(agentRuns)
        .set({
          status: "completed",
          output,
          steps: [...steps, { step: "completed", status: "ok", at: now() }],
          creditsUsed: 5,
          completedAt: new Date(),
        })
        .where(eq(agentRuns.id, run.id));

      await tx
        .update(agents)
        .set({
          runCount: sql`${agents.runCount} + 1`,
          lastRunAt: new Date(),
          nextRunAt: agent.scheduleCron
            ? new Date(Date.now() + scheduleIntervalMs(agent.scheduleCron))
            : null,
        })
        .where(eq(agents.id, agent.id));
    });

    // complete any task that routed this run
    if (run.taskId) {
      await ctx.db
        .update(tasks)
        .set({ status: "done", completedAt: new Date() })
        .where(and(eq(tasks.id, run.taskId), eq(tasks.workspaceId, workspaceId)));
    }

    await logActivity(ctx, ctx.db, {
      workspaceId,
      entityType: "agent_run",
      entityId: run.id,
      companyId: run.companyId,
      dealId: run.dealId,
      type: "agent_run.completed",
      summary: `Agent "${agent.name}" completed`,
      actor: "ai",
      data: { output },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db
      .update(agentRuns)
      .set({
        status: "failed",
        error: message.slice(0, 500),
        steps: [
          ...steps,
          { step: "failed", status: "error", detail: message.slice(0, 200), at: now() },
        ],
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id));

    await logActivity(ctx, ctx.db, {
      workspaceId,
      entityType: "agent_run",
      entityId: run.id,
      type: "agent_run.failed",
      summary: `Agent run failed: ${message.slice(0, 140)}`,
      actor: "system",
      data: { error: message },
    });
  }
}

/**
 * Scheduler tick: find active scheduled agents whose nextRunAt is due,
 * create a queued run for each, and enqueue them. Called every minute by
 * the worker loop.
 */
export async function scheduleDueAgents(ctx: CoreContext): Promise<number> {
  const due = await ctx.db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.isActive, true),
        sql`${agents.scheduleCron} is not null`,
        sql`${agents.nextRunAt} is not null and ${agents.nextRunAt} <= now()`,
      ),
    )
    .limit(20);

  let enqueued = 0;
  for (const agent of due) {
    // skip if a run is already in flight for this agent
    const [inFlight] = await ctx.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agent.id), eq(agentRuns.workspaceId, agent.workspaceId)))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);
    void inFlight;

    const [run] = await ctx.db
      .insert(agentRuns)
      .values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        status: "queued",
        trigger: "schedule",
        input: {},
        steps: [{ step: "queued", status: "ok", at: now() }],
      })
      .returning();

    await ctx.enqueue("run-agent", { workspaceId: agent.workspaceId, runId: run.id });
    enqueued++;
  }
  return enqueued;
}

/* ── helpers ───────────────────────────────────────────────────────── */

function now(): string {
  return new Date().toISOString();
}

async function resolveCompanyId(
  ctx: CoreContext,
  run: typeof agentRuns.$inferSelect,
): Promise<string | null> {
  if (run.dealId) {
    const [deal] = await ctx.db.select({ companyId: deals.companyId }).from(deals).where(eq(deals.id, run.dealId));
    return deal?.companyId ?? null;
  }
  if (run.taskId) {
    const [task] = await ctx.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, run.taskId), eq(tasks.workspaceId, run.workspaceId)));
    return task?.companyId ?? null;
  }
  if (run.spaceId) {
    const [space] = await ctx.db.select({ companyId: spaces.companyId }).from(spaces).where(eq(spaces.id, run.spaceId));
    return space?.companyId ?? null;
  }
  return null;
}

async function companyName(ctx: CoreContext, companyId: string): Promise<string> {
  const [row] = await ctx.db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
  return row?.name ?? "Company";
}

/**
 * Coarse cron→interval mapping for the built-in scheduler tick
 * (hourly granularity is plenty for monitoring-class agents).
 */
export function scheduleIntervalMs(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 60 * 60 * 1000;
  const minute = Number(parts[0]);
  const [, hour, , , dow] = parts;
  // "*/N H * * *" style every-N-hours when the hour field encodes a step
  if (hour?.startsWith("*/")) {
    const step = Number(hour.slice(2));
    if (!Number.isNaN(step) && step > 0) return step * 60 * 60 * 1000;
  }
  if (dow && dow !== "*") return 24 * 60 * 60 * 1000;
  if (!Number.isNaN(minute)) return 60 * 60 * 1000;
  return 60 * 60 * 1000;
}
