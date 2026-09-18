import { eq, sql } from "drizzle-orm";
import { workspaces, creditLedger } from "@copyr/db/schema.js";
import { CoreError, type CoreContext } from "./context.js";

export type CreditReason =
  | "monthly_grant"
  | "signup_grant"
  | "deck_extraction"
  | "email_triage"
  | "update_classification"
  | "assistant_turn"
  | "link_conversion"
  | "manual_adjustment"
  | "vault_review"
  | "research_report"
  | "agent_run";

const COSTS: Partial<Record<CreditReason, number>> = {
  deck_extraction: 2,
  email_triage: 1,
  update_classification: 1,
  assistant_turn: 1,
  link_conversion: 1,
  vault_review: 3,
  research_report: 4,
  agent_run: 5,
};

export function creditCost(reason: CreditReason): number {
  return COSTS[reason] ?? 0;
}

/**
 * Atomically spend credits; throws 402-equivalent when the workspace is out.
 * Runs inside caller's transaction when provided.
 */
export async function spendCredits(
  ctx: CoreContext,
  tx: Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0],
  workspaceId: string,
  reason: CreditReason,
  ref?: { refType?: string; refId?: string },
): Promise<number> {
  const cost = creditCost(reason);
  if (cost === 0) return 0;

  const [updated] = await tx
    .update(workspaces)
    .set({
      aiCreditsBalance: sql`${workspaces.aiCreditsBalance} - ${cost}`,
      updatedAt: new Date(),
    })
    .where(sql`${workspaces.id} = ${workspaceId} and ${workspaces.aiCreditsBalance} >= ${cost}`)
    .returning({ balance: workspaces.aiCreditsBalance });

  if (!updated) {
    throw new CoreError("AI credit balance exhausted", {
      code: "credits_exhausted",
      status: 402,
    });
  }

  await tx.insert(creditLedger).values({
    workspaceId,
    delta: -cost,
    reason,
    refType: ref?.refType ?? null,
    refId: (ref?.refId as never) ?? null,
    balanceAfter: updated.balance,
  });
  return updated.balance;
}

export async function grantCredits(
  ctx: CoreContext,
  workspaceId: string,
  amount: number,
  reason: Extract<CreditReason, "monthly_grant" | "signup_grant" | "manual_adjustment">,
): Promise<number> {
  const [updated] = await ctx.db
    .update(workspaces)
    .set({ aiCreditsBalance: sql`${workspaces.aiCreditsBalance} + ${amount}` })
    .where(eq(workspaces.id, workspaceId))
    .returning({ balance: workspaces.aiCreditsBalance });
  if (!updated) throw new CoreError("workspace not found", { status: 404 });
  await ctx.db.insert(creditLedger).values({
    workspaceId,
    delta: amount,
    reason,
    balanceAfter: updated.balance,
  });
  return updated.balance;
}
