import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  workflows,
  workflowRuns,
  stages as stagesT,
  activities,
  agents,
  agentRuns,
  companies as companiesT,
} from "@copyr/db/schema.js";
import type { RealtimeEvent, WorkflowDto, WorkflowRunDto, CreateWorkflowInput } from "@copyr/contracts";
import { createWorkflowSchema, TRIGGER_EVENTS } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";
import { setFieldValues } from "./fields.js";
import * as dealsSvc from "./deals.js";
import * as companiesSvc from "./companies.js";
import * as emailsSvc from "./emails.js";
import * as contentSvc from "./content.js";

/* ── session used when workflows act ───────────────────────────────── */

const automationSession = (workspaceId: string, userId?: string | null): Session => ({
  workspaceId,
  actor: { userId: userId ?? null, source: "agent" },
});

/* ── CRUD ──────────────────────────────────────────────────────────── */

function mapWorkflow(row: typeof workflows.$inferSelect): WorkflowDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerEvent: row.triggerEvent,
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    isEnabled: row.isEnabled,
    runCount: row.runCount,
    lastRunAt: toIso(row.lastRunAt),
    createdAt: toIso(row.createdAt)!,
  };
}

export async function listWorkflows(ctx: CoreContext, session: Session): Promise<WorkflowDto[]> {
  const rows = await ctx.db
    .select()
    .from(workflows)
    .where(eq(workflows.workspaceId, session.workspaceId))
    .orderBy(desc(workflows.createdAt));
  return rows.map(mapWorkflow);
}

async function getWorkflowRow(
  ctx: CoreContext,
  workspaceId: string,
  workflowId: string,
) {
  const [row] = await ctx.db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, workspaceId)));
  if (!row) throw new CoreError("workflow not found", { status: 404 });
  return row;
}

export async function getWorkflow(
  ctx: CoreContext,
  session: Session,
  workflowId: string,
): Promise<WorkflowDto> {
  return mapWorkflow(await getWorkflowRow(ctx, session.workspaceId, workflowId));
}

export async function createWorkflow(
  ctx: CoreContext,
  session: Session,
  input: CreateWorkflowInput,
): Promise<WorkflowDto> {
  const parsed = createWorkflowSchema.parse(input);
  const [row] = await ctx.db
    .insert(workflows)
    .values({
      workspaceId: session.workspaceId,
      name: parsed.name,
      description: parsed.description ?? null,
      triggerEvent: parsed.triggerEvent,
      conditions: parsed.conditions,
      actions: parsed.actions,
      isEnabled: parsed.isEnabled,
      createdByUserId: session.actor.userId,
    })
    .returning();
  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "workspace",
    entityId: session.workspaceId,
    type: "workflow.created",
    summary: `Automation "${parsed.name}" created`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
    data: { __wf: true },
  });
  return mapWorkflow(row!);
}

export async function updateWorkflow(
  ctx: CoreContext,
  session: Session,
  workflowId: string,
  patch: Partial<CreateWorkflowInput>,
): Promise<WorkflowDto> {
  await getWorkflowRow(ctx, session.workspaceId, workflowId);
  const [row] = await ctx.db
    .update(workflows)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.triggerEvent !== undefined ? { triggerEvent: patch.triggerEvent } : {}),
      ...(patch.conditions !== undefined ? { conditions: patch.conditions } : {}),
      ...(patch.actions !== undefined ? { actions: patch.actions } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled } : {}),
    })
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, session.workspaceId)))
    .returning();
  return mapWorkflow(row!);
}

export async function deleteWorkflow(
  ctx: CoreContext,
  session: Session,
  workflowId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, session.workspaceId)))
    .returning({ id: workflows.id });
  if (!deleted.length) throw new CoreError("workflow not found", { status: 404 });
}

/* ── runs listing ──────────────────────────────────────────────────── */

export async function listRuns(
  ctx: CoreContext,
  session: Session,
  filter: { workflowId?: string; limit?: number },
): Promise<WorkflowRunDto[]> {
  const conds = [eq(workflowRuns.workspaceId, session.workspaceId)];
  if (filter.workflowId) conds.push(eq(workflowRuns.workflowId, filter.workflowId));
  const rows = await ctx.db
    .select({ run: workflowRuns, workflowName: workflows.name })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
    .where(and(...conds))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(filter.limit ?? 50);
  return rows.map(({ run, workflowName }) => ({
    id: run.id,
    workflowId: run.workflowId,
    workflowName,
    triggerEvent: run.triggerEvent,
    entityType: run.entityType,
    entityId: run.entityId,
    status: run.status,
    steps: run.steps ?? [],
    error: run.error,
    createdAt: toIso(run.createdAt)!,
    completedAt: toIso(run.completedAt),
  }));
}

/* ── event snapshot & condition evaluation ─────────────────────────── */

type Snapshot = Record<string, unknown>;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function evaluateCondition(
  snapshot: Snapshot,
  cond: { field: string; op: string; value?: unknown },
): boolean {
  const actual = getPath(snapshot, cond.field);
  switch (cond.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      return normalize(actual) === normalize(cond.value);
    case "neq":
      return normalize(actual) !== normalize(cond.value);
    case "contains": {
      if (Array.isArray(actual)) return actual.map(normalize).includes(normalize(cond.value));
      if (actual === null || actual === undefined) return false;
      return String(actual).toLowerCase().includes(String(cond.value ?? "").toLowerCase());
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(cond.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (cond.op === "gt") return a > b;
      if (cond.op === "gte") return a >= b;
      if (cond.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v).toString();
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(normalize);
  return String(v).toLowerCase();
}

/** Build the dot-path-addressable snapshot for an event's subject. */
interface EventRef {
  entityType: string;
  entityId: string;
  type: string;
  actor: "user" | "ai" | "system";
}

async function buildSnapshot(
  ctx: CoreContext,
  workspaceId: string,
  ev: EventRef,
): Promise<Snapshot> {
  const snap: Snapshot = {
    event: { type: ev.type, actor: ev.actor },
  };
  try {
    switch (ev.entityType) {
      case "deal": {
        const deal = await dealsSvc.getDeal(ctx, { workspaceId, actor: { userId: null, source: "api" } }, ev.entityId);
        snap["deal"] = await withStageName(ctx, deal);
        snap["company"] = deal.company;
        break;
      }
      case "company": {
        const company = await companiesSvc.getCompany(
          ctx,
          { workspaceId, actor: { userId: null, source: "api" } },
          ev.entityId,
        );
        snap["company"] = await withStageName(ctx, company);
        break;
      }
      case "email": {
        snap["email"] = await emailsSvc.getEmail(
          ctx,
          { workspaceId, actor: { userId: null, source: "api" } },
          ev.entityId,
        );
        break;
      }
      case "agent_run": {
        // A codified agent finished — expose its output as the snapshot so
        // workflows can gate on results ("output.recommendation eq advance")
        // and act with the same company/deal scope the agent ran in.
        const [run] = await ctx.db
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.id, ev.entityId), eq(agentRuns.workspaceId, workspaceId)));
        if (!run) break;
        const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, run.agentId));
        const input = (run.input ?? {}) as Record<string, unknown>;
        snap["run"] = {
          id: run.id,
          status: run.status,
          trigger: run.trigger,
          error: run.error ?? null,
          originWorkflowId: typeof input.__wfOriginWorkflowId === "string" ? input.__wfOriginWorkflowId : null,
        };
        snap["agent"] = { name: agent?.name ?? null, kind: agent?.kind ?? null };
        snap["output"] = (run.output ?? {}) as Record<string, unknown>;
        if (run.companyId) {
          const [company] = await ctx.db.select().from(companiesT).where(eq(companiesT.id, run.companyId));
          if (company) snap["company"] = { ...company, id: company.id, name: company.name };
        }
        const dealScopeId = run.dealId ?? run.companyId;
        if (dealScopeId) {
          try {
            const deal = await dealsSvc.getDeal(ctx, { workspaceId, actor: { userId: null, source: "api" } }, dealScopeId);
            snap["deal"] = await withStageName(ctx, deal);
          } catch {
            // deal gone — conditions on deal paths simply fail
          }
        }
        break;
      }
      default:
        break;
    }
  } catch {
    // entity deleted mid-flight — empty snapshot, `exists` conditions fail
  }
  return snap;
}

/** Attach `stageName` so conditions can gate on "Due Diligence" instead of opaque UUIDs. */
async function withStageName<T extends { stageId?: string | null }>(
  ctx: CoreContext,
  entity: T,
): Promise<T & { stageName: string | null }> {
  if (!entity.stageId) return { ...entity, stageName: null };
  const [row] = await ctx.db
    .select({ name: stagesT.name })
    .from(stagesT)
    .where(eq(stagesT.id, entity.stageId))
    .limit(1);
  return { ...entity, stageName: row?.name ?? null };
}

function interpolate(template: string, snapshot: Snapshot): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = getPath(snapshot, path);
    return v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  });
}

/* ── action execution ──────────────────────────────────────────────── */

interface StepResult {
  actionIndex: number;
  type: string;
  status: "ok" | "error" | "skipped";
  detail?: string;
  at: string;
}

async function executeAction(
  ctx: CoreContext,
  session: Session,
  action: { type: string; config: Record<string, unknown> },
  index: number,
  snapshot: Snapshot,
  workflowId?: string,
): Promise<StepResult> {
  const at = new Date().toISOString();
  const cfg = action.config ?? {};
  try {
    switch (action.type) {
      case "add_note": {
        const body = interpolate(String(cfg.body ?? "(empty)"), snapshot);
        await contentSvc.addNote(ctx, session, {
          body,
          companyId: (getPath(snapshot, "company.id") as string) ?? undefined,
          dealId: (getPath(snapshot, "deal.id") as string) ?? undefined,
        });
        return { actionIndex: index, type: action.type, status: "ok", detail: body.slice(0, 120), at };
      }
      case "move_deal": {
        const dealId = getPath(snapshot, "deal.id") as string | undefined;
        if (!dealId) return skipped(index, action.type, at, "no deal in scope");
        const stageName = String(cfg.stageName ?? "");
        const pipelineId = getPath(snapshot, "deal.pipelineId") as string | undefined;
        const stageRows = await ctx.db
          .select()
          .from(stagesT)
          .where(sql`${stagesT.workspaceId} = ${session.workspaceId} and lower(${stagesT.name}) = lower(${stageName})${pipelineId ? sql` and ${stagesT.pipelineId} = ${pipelineId}` : sql``}`);
        const stage = stageRows[0];
        if (!stage) return skipped(index, action.type, at, `stage "${stageName}" not found`);
        await dealsSvc.moveDeal(ctx, session, dealId, { stageId: stage.id });
        return { actionIndex: index, type: action.type, status: "ok", detail: `→ ${stage.name}`, at };
      }
      case "set_deal_fields": {
        const dealId = getPath(snapshot, "deal.id") as string | undefined;
        if (!dealId) return skipped(index, action.type, at, "no deal in scope");
        const fields = (cfg.fields ?? {}) as Record<string, never>;
        await ctx.db.transaction(async (tx) =>
          setFieldValues(ctx, tx as never, session, "deal", dealId, fields),
        );
        return { actionIndex: index, type: action.type, status: "ok", detail: Object.keys(fields).join(","), at };
      }
      case "set_company_fields": {
        const companyId = (getPath(snapshot, "company.id") as string) ?? undefined;
        if (!companyId) return skipped(index, action.type, at, "no company in scope");
        const fields = (cfg.fields ?? {}) as Record<string, never>;
        await ctx.db.transaction(async (tx) =>
          setFieldValues(ctx, tx as never, session, "company", companyId, fields),
        );
        return { actionIndex: index, type: action.type, status: "ok", detail: Object.keys(fields).join(","), at };
      }
      case "webhook": {
        const url = String(cfg.url ?? "");
        if (!/^https?:\/\//.test(url)) return skipped(index, action.type, at, "invalid url");
        const body = JSON.stringify({
          event: "workflow.action",
          company: getPath(snapshot, "company.name"),
          dealId: getPath(snapshot, "deal.id") ?? null,
          at,
        });
        const secret = typeof cfg.secret === "string" ? cfg.secret : "";
        const { signPayload } = await import("./outbound.js");
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-copyr-event": "workflow.action",
            ...(secret ? { "x-copyr-signature": signPayload(secret, body) } : {}),
          },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) throw new Error(`webhook endpoint returned ${res.status}`);
        return { actionIndex: index, type: action.type, status: "ok", detail: `HTTP ${res.status}`, at };
      }
      case "create_portfolio_update": {
        const companyId = getPath(snapshot, "company.id") as string | undefined;
        if (!companyId) return skipped(index, action.type, at, "no company in scope");
        const upd = await contentSvc.createPortfolioUpdate(ctx, session, {
          companyId,
          title: interpolate(String(cfg.title ?? "Automated update"), snapshot),
          body: cfg.body ? interpolate(String(cfg.body), snapshot) : undefined,
          kind: (cfg.kind as never) ?? "update",
        });
        return { actionIndex: index, type: action.type, status: "ok", detail: upd.id, at };
      }
      case "run_agent": {
        // Dispatch a codified agent scoped to this event's entity — the bridge
        // that turns event-triggered automations into judgment work.
        let agentRow: typeof agents.$inferSelect | undefined;
        if (typeof cfg.agentId === "string") {
          [agentRow] = await ctx.db
            .select()
            .from(agents)
            .where(and(eq(agents.id, cfg.agentId), eq(agents.workspaceId, session.workspaceId)));
        } else if (typeof cfg.agentName === "string") {
          [agentRow] = await ctx.db
            .select()
            .from(agents)
            .where(
              and(
                eq(agents.workspaceId, session.workspaceId),
                sql`lower(${agents.name}) = lower(${cfg.agentName})`,
              ),
            );
        }
        if (!agentRow) {
          return skipped(index, action.type, at, `agent "${String(cfg.agentName ?? cfg.agentId ?? "?")}" not found`);
        }
        if (!agentRow.isActive) {
          return skipped(index, action.type, at, `agent "${agentRow.name}" is inactive`);
        }

        const { queueAgentRun } = await import("./agents.js");
        const queued = await queueAgentRun(ctx, session, agentRow.id, {
          companyId: (getPath(snapshot, "company.id") as string) ?? undefined,
          dealId: (getPath(snapshot, "deal.id") as string) ?? undefined,
          trigger: "workflow",
          __wfOriginWorkflowId: workflowId,
        } as never);
        return {
          actionIndex: index,
          type: action.type,
          status: "ok",
          detail: `dispatched "${agentRow.name}" (run ${queued.run.id.slice(0, 8)})`,
          at,
        };
      }
      default:
        return skipped(index, action.type, at, "unknown action type");
    }
  } catch (err) {
    return {
      actionIndex: index,
      type: action.type,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      at,
    };
  }
}

function skipped(index: number, type: string, at: string, detail: string): StepResult {
  return { actionIndex: index, type, status: "skipped", detail, at };
}

/* ── evaluator ─────────────────────────────────────────────────────── */

/** Chain safety: max runs touching the same entity per minute. */
const MAX_RUNS_PER_ENTITY_PER_MINUTE = 5;

/**
 * Evaluate every enabled workflow matching this event and execute matches.
 * Called by the `run-workflows` job. Loop-safe via three guards:
 *  1. events flagged `data.__wf` are ignored (our own activity emissions)
 *  2. identical (workflow, entity) runs are debounced within 2s
 *  3. per-entity chain depth capped per minute
 */
export async function evaluateWorkflowsForEvent(
  ctx: CoreContext,
  event: RealtimeEvent,
): Promise<{ evaluated: number; ran: number }> {
  if ((event.data as Record<string, unknown> | null)?.__wf) return { evaluated: 0, ran: 0 };

  // only known triggers are storable (pg enum); other activity types would
  // fail the query against the enum column — skip them before touching SQL
  if (!(TRIGGER_EVENTS as readonly string[]).includes(event.type)) {
    return { evaluated: 0, ran: 0 };
  }

  const rows = await ctx.db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.workspaceId, event.workspaceId),
        eq(workflows.isEnabled, true),
        eq(workflows.triggerEvent, event.type as never),
      ),
    );
  if (!rows.length) return { evaluated: 0, ran: 0 };

  const snapshot = await buildSnapshot(ctx, event.workspaceId, event);
  let ran = 0;

  // chain guard: an agent run dispatched by workflow W must not re-trigger W
  // when it completes (direct self-loops), while still allowing A → B chains.
  const isAgentRunEvent = event.entityType === "agent_run";
  const agentRunTrigger = isAgentRunEvent ? getPath(snapshot, "run.trigger") : null;
  const originWorkflowId = isAgentRunEvent ? getPath(snapshot, "run.originWorkflowId") : null;

  for (const wf of rows) {
    if (
      isAgentRunEvent &&
      agentRunTrigger === "workflow" &&
      typeof originWorkflowId === "string" &&
      originWorkflowId === wf.id
    ) {
      continue;
    }

    // debounce identical (workflow, entity) runs
    const [recent] = await ctx.db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, wf.id),
          eq(workflowRuns.triggerEvent, event.type),
          gte(workflowRuns.createdAt, new Date(Date.now() - 2_000)),
          event.entityId ? sql`${workflowRuns.entityId} = ${event.entityId}` : sql`true`,
        ),
      )
      .limit(1);
    if (recent) continue;

    const allConditionsMatch =
      !wf.conditions?.length ||
      wf.conditions.every((c) => evaluateCondition(snapshot, c));
    if (!allConditionsMatch) continue;

    // chain depth guard on the same entity
    if (event.entityId) {
      const [{ count }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, event.workspaceId),
            gte(workflowRuns.createdAt, new Date(Date.now() - 60_000)),
            sql`${workflowRuns.entityId} = ${event.entityId}`,
          ),
        );
      if (count >= MAX_RUNS_PER_ENTITY_PER_MINUTE) continue;
    }

    const [run] = await ctx.db
      .insert(workflowRuns)
      .values({
        workspaceId: event.workspaceId,
        workflowId: wf.id,
        triggerEvent: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        status: "running",
      })
      .returning();

    try {
      const session = automationSession(event.workspaceId, wf.createdByUserId);
      const steps: StepResult[] = [];
      for (let i = 0; i < (wf.actions ?? []).length; i++) {
        const result = await executeAction(ctx, session, wf.actions[i]!, i, snapshot, wf.id);
        steps.push(result);
      }
      const failed = steps.some((st) => st.status === "error");
      await ctx.db
        .update(workflowRuns)
        .set({
          status: failed ? "failed" : "completed",
          steps,
          completedAt: new Date(),
          error: failed ? steps.filter((s) => s.status === "error").map((s) => s.detail).join("; ") : null,
        })
        .where(eq(workflowRuns.id, run!.id));

      await ctx.db
        .update(workflows)
        .set({ runCount: sql`${workflows.runCount} + 1`, lastRunAt: new Date() })
        .where(eq(workflows.id, wf.id));

      await logActivity(ctx, ctx.db, {
        workspaceId: event.workspaceId,
        entityType: event.entityType as never,
        entityId: event.entityId,
        companyId: (getPath(snapshot, "company.id") as string) ?? null,
        dealId: (getPath(snapshot, "deal.id") as string) ?? null,
        type: "workflow.run",
        summary: `Automation "${wf.name}" ${failed ? "partially failed" : "ran"} (${steps.filter((s) => s.status === "ok").length}/${steps.length} actions)`,
        actor: "ai",
        data: { __wf: true, workflowId: wf.id, steps },
      });
      ran++;
    } catch (err) {
      await ctx.db
        .update(workflowRuns)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        .where(eq(workflowRuns.id, run!.id));
    }
  }

  return { evaluated: rows.length, ran };
}

/* ── dry-run testing ───────────────────────────────────────────────── */

export interface WorkflowTestResult {
  matched: boolean;
  conditions: Array<{ field: string; op: string; passed: boolean; actual?: unknown }>;
  plannedActions: Array<{ type: string; config: Record<string, unknown> }>;
  snapshotKeys: string[];
  note?: string;
}

/**
 * Dry-run a workflow against the most recent real entity of its trigger type.
 * Nothing is executed — safe to call repeatedly while configuring.
 */
export async function testWorkflow(
  ctx: CoreContext,
  session: Session,
  workflowId: string,
): Promise<WorkflowTestResult> {
  const wf = await getWorkflowRow(ctx, session.workspaceId, workflowId);

  // find most recent entity of the trigger type by mapping event → entity
  const entityTypeByTrigger: Record<string, string> = {
    "company.created": "company",
    "company.updated": "company",
    "deal.created": "deal",
    "deal.stage_changed": "deal",
    "deal.updated": "deal",
    "email.processed": "email",
    "email.needs_review": "email",
    "document.parsed": "document",
    "extraction.completed": "document",
    "note.added": "note",
    "portfolio_update.created": "portfolio_update",
    "agent_run.completed": "agent_run",
  };
  const entityType = entityTypeByTrigger[wf.triggerEvent] ?? "company";

  const [latestActivity] = await ctx.db
    .select({ entityId: activities.entityId })
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, session.workspaceId),
        eq(activities.type, wf.triggerEvent),
        eq(activities.entityType, entityType as never),
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(1);

  if (!latestActivity?.entityId) {
    return {
      matched: false,
      conditions: [],
      plannedActions: wf.actions ?? [],
      snapshotKeys: [],
      note: `No historical "${wf.triggerEvent}" event found yet — trigger an event of this type first.`,
    };
  }

  const snapshot = await buildSnapshot(ctx, session.workspaceId, {
    entityType,
    entityId: latestActivity.entityId,
    type: wf.triggerEvent,
    actor: "user",
  });

  const conditions = (wf.conditions ?? []).map((c) => ({
    field: c.field,
    op: c.op,
    passed: evaluateCondition(snapshot, c),
    actual: getPath(snapshot, c.field) ?? null,
  }));

  void ctx;
  return {
    matched: conditions.every((c) => c.passed),
    conditions,
    plannedActions: wf.actions ?? [],
    snapshotKeys: Object.keys(snapshot),
  };
}

/* ── saved views ───────────────────────────────────────────────────── */

const savedViewsT = () => {
  // lazy import keeps this file independent of schema load order
  return import("@copyr/db/schema.js").then((m) => m.savedViews);
};

export async function listSavedViews(ctx: CoreContext, session: Session, resource = "deals") {
  const t = await savedViewsT();
  const { desc } = await import("drizzle-orm");
  return ctx.db
    .select()
    .from(t)
    .where(sql`${t.workspaceId} = ${session.workspaceId} and ${t.resource} = ${resource}`)
    .orderBy(desc(t.createdAt));
}

export async function createSavedView(
  ctx: CoreContext,
  session: Session,
  input: { name: string; query: Record<string, string> },
  resource = "deals",
) {
  const t = await savedViewsT();
  const [row] = await ctx.db
    .insert(t)
    .values({
      workspaceId: session.workspaceId,
      name: input.name,
      resource,
      query: input.query,
      createdByUserId: session.actor.userId,
    })
    .returning();
  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "workspace",
    entityId: session.workspaceId,
    type: "view.saved",
    summary: `Saved view "${input.name}" created`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
    data: { __wf: true },
  });
  return row;
}

export async function deleteSavedView(
  ctx: CoreContext,
  session: Session,
  viewId: string,
): Promise<void> {
  const t = await savedViewsT();
  const deleted = await ctx.db
    .delete(t)
    .where(sql`${t.id} = ${viewId} and ${t.workspaceId} = ${session.workspaceId}`)
    .returning({ id: t.id });
  if (!deleted.length) throw new CoreError("saved view not found", { status: 404 });
}
