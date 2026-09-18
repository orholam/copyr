import { desc, eq, sql } from "drizzle-orm";
import { agentRuns, agents, workflowRuns, workflows } from "@copyr/db/schema.js";
import type { CoreContext, Session } from "../context.js";
import type { AgentDto, WorkflowDto } from "@copyr/contracts";
import { toIso } from "../mappers.js";

/**
 * Unified view over the two automation engines:
 *  - codified agents  (LLM judgment: screens, checklists, monitors)
 *  - event workflows  (deterministic routing: when X and Y then Z — incl. run_agent)
 * Presented as ONE surface with a merged activity feed.
 */

export interface AutomationRunItem {
  id: string;
  source: "agent" | "workflow";
  name: string;
  status: string;
  trigger?: string | null;
  summary: string;
  createdAt: string;
}

export interface AutomationsOverview {
  agents: AgentDto[];
  workflows: WorkflowDto[];
  runs: AutomationRunItem[];
  stats: {
    activeAgents: number;
    enabledWorkflows: number;
    runsLast7d: number;
    chainRunsLast7d: number; // workflow runs that dispatched or reacted to agents
  };
}

function summarizeAgentRun(output: Record<string, unknown> | null, error: string | null): string {
  if (error) return error.slice(0, 140);
  if (!output) return "queued";
  const o = output as Record<string, unknown>;
  if (typeof o.fitScore === "number") {
    return `${o.fitScore}/100 → ${String(o.recommendation ?? "?").toUpperCase()}${o.summary ? ` · ${String(o.summary).slice(0, 90)}` : ""}`;
  }
  if (Array.isArray(o.createdTasks)) return `provisioned ${(o.createdTasks as unknown[]).length} task(s)`;
  if (typeof o.summary === "string") return o.summary.slice(0, 140);
  if (Array.isArray(o.highlights)) return `${(o.highlights as unknown[]).length} highlight(s)`;
  return "completed";
}

function summarizeWorkflowRun(steps: Array<{ status: string; detail?: string }> | null, error: string | null): string {
  if (error) return error.slice(0, 140);
  const stepsList = steps ?? [];
  const ok = stepsList.filter((s) => s.status === "ok");
  return stepsList.length
    ? ok.map((s) => s.detail ?? "").filter(Boolean).join(" · ").slice(0, 160)
    : "no actions executed";
}

export async function overview(
  ctx: CoreContext,
  session: Session,
): Promise<AutomationsOverview> {
  const { listAgents } = await import("./agents.js");
  const { listWorkflows } = await import("./automation.js");
  const [agentRows, workflowRows, agentRunRows, workflowRunRows] = await Promise.all([
    listAgents(ctx, session),
    listWorkflows(ctx, session),
    ctx.db
      .select({ run: agentRuns, name: agents.name })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .where(eq(agentRuns.workspaceId, session.workspaceId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(40),
    ctx.db
      .select({ run: workflowRuns, name: workflows.name })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(eq(workflowRuns.workspaceId, session.workspaceId))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(40),
  ]);

  const runs: AutomationRunItem[] = [
    ...agentRunRows.map(({ run, name }) => ({
      id: run.id,
      source: "agent" as const,
      name,
      status: run.status,
      trigger: run.trigger,
      summary: summarizeAgentRun((run.output ?? null) as Record<string, unknown> | null, run.error),
      createdAt: toIso(run.createdAt)!,
    })),
    ...workflowRunRows.map(({ run, name }) => ({
      id: run.id,
      source: "workflow" as const,
      name,
      status: run.status,
      trigger: run.triggerEvent,
      summary: summarizeWorkflowRun(run.steps ?? null, run.error),
      createdAt: toIso(run.createdAt)!,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  const [{ count: runsLast7d }] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(sql`${agentRuns.workspaceId} = ${session.workspaceId} and ${agentRuns.createdAt} > now() - interval '7 days'`);
  const [{ count: wfRuns7d }] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowRuns)
    .where(sql`${workflowRuns.workspaceId} = ${session.workspaceId} and ${workflowRuns.createdAt} > now() - interval '7 days'`);

  // chain runs = workflows whose trigger is an agent completion, or whose
  // actions dispatch an agent — the unified graph in action
  const chainWorkflowIds = workflowRows
    .filter(
      (w) =>
        w.triggerEvent === "agent_run.completed" ||
        w.actions.some((a) => a.type === "run_agent"),
    )
    .map((w) => w.id);

  let chainRuns = 0;
  if (chainWorkflowIds.length) {
    const [{ count }] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(
        sql`${workflowRuns.workspaceId} = ${session.workspaceId}
            and ${workflowRuns.createdAt} > now() - interval '7 days'
            and ${workflowRuns.workflowId} in ${chainWorkflowIds}`,
      );
    chainRuns = count ?? 0;
  }

  void wfRuns7d;

  return {
    agents: agentRows,
    workflows: workflowRows,
    runs,
    stats: {
      activeAgents: agentRows.filter((a) => a.isActive).length,
      enabledWorkflows: workflowRows.filter((w) => w.isEnabled).length,
      runsLast7d: (runsLast7d ?? 0) + (wfRuns7d ?? 0),
      chainRunsLast7d: chainRuns ?? 0,
    },
  };
}
