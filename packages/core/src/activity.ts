import { activities } from "@copyr/db/schema.js";
import type { DbOrTx } from "@copyr/db";
import { sql } from "drizzle-orm";
import type { ActivityActor, RealtimeEvent } from "@copyr/contracts";
import type { CoreContext } from "./context.js";

type EntityType =
  | "company"
  | "deal"
  | "document"
  | "email"
  | "note"
  | "share_link"
  | "portfolio_update"
  | "contact"
  | "stage"
  | "pipeline"
  | "custom_field"
  | "workspace"
  | "vault"
  | "review_table"
  | "agent"
  | "agent_run"
  | "space"
  | "task"
  | "memory"
  | "research_report";

export interface LogActivityInput {
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  type: string;
  summary: string;
  actor: ActivityActor;
  actorUserId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  data?: Record<string, unknown> | null;
}

const CHANNEL = "copyr_events";

/**
 * Single write path for audit trail + realtime stream. Pass the SAME
 * transaction performing the mutation: the row insert and pg_notify commit
 * atomically, and NOTIFY delivery happens on commit (no phantom events).
 * Falls back to publishing outside a tx when none is supplied.
 */
export async function logActivity(
  ctx: CoreContext,
  exec: DbOrTx,
  input: LogActivityInput,
): Promise<void> {
  const createdAt = new Date();
  await exec.insert(activities).values({
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    type: input.type,
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
    summary: input.summary,
    data: input.data ?? null,
    createdAt,
  });

  const event: RealtimeEvent = {
    id: `${createdAt.getTime()}-${input.entityId}`,
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    type: input.type,
    actor: input.actor,
    summary: input.summary,
    data: input.data ?? null,
    createdAt: createdAt.toISOString(),
  };
  const json = JSON.stringify(event);
  const safePayload = json.length > 7000 ? `${json.slice(0, 7000)}` : json;
  await exec.execute(
    sql`select pg_notify(${CHANNEL}, ${safePayload})`,
  );

  // When pg-boss is disabled, NOTIFY alone won't run automations (no worker
  // subscribed). Evaluate workflows inline so Thesis Screener etc. still fire.
  if (!ctx.boss && !(event.data as Record<string, unknown> | null)?.__wf) {
    void import("./services/automation.js")
      .then((m) => m.evaluateWorkflowsForEvent(ctx, event))
      .catch((err) => {
        console.error("[run-workflows-inline]", err instanceof Error ? err.message : err);
      });
  }
}
