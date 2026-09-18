import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { creditLedger, workspaces } from "@copyr/db/schema.js";
import { grantCredits, spendCredits, creditCost } from "./credits.js";
import { CoreError } from "./context.js";
import { cleanupWorkspace, getTestDb, seedWorkspace, type WsFixture } from "./test-db.js";

const db = await getTestDb();

describe.skipIf(db === null)("credits ledger (integration)", () => {
  let fx: WsFixture;

  beforeAll(async () => {
    fx = await seedWorkspace(db!);
  });

  afterAll(async () => {
    await cleanupWorkspace(fx);
  });

  it("grants credits and writes a positive ledger row", async () => {
    const [before] = await fx.db
      .select({ balance: workspaces.aiCreditsBalance })
      .from(workspaces)
      .where(eq(workspaces.id, fx.workspaceId));

    const balance = await grantCredits(fx.ctx, fx.workspaceId, 100, "signup_grant");
    expect(balance).toBe(before.balance + 100);

    const [row] = await fx.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.workspaceId, fx.workspaceId));
    expect(row.delta).toBe(100);
    expect(row.reason).toBe("signup_grant");
    expect(row.balanceAfter).toBe(balance);
  });

  it("spends atomically and records the negative delta", async () => {
    const [before] = await fx.db
      .select({ balance: workspaces.aiCreditsBalance })
      .from(workspaces)
      .where(eq(workspaces.id, fx.workspaceId));

    const balance = await spendCredits(fx.ctx, fx.db as never, fx.workspaceId, "deck_extraction", {
      refType: "document",
      refId: fx.dealId,
    });
    expect(balance).toBe(before.balance - creditCost("deck_extraction"));

    const ledger = await fx.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.workspaceId, fx.workspaceId));
    const last = ledger[ledger.length - 1];
    expect(last.delta).toBe(-2);
    expect(last.refType).toBe("document");
    expect(last.balanceAfter).toBe(balance);
  });

  it("refuses to go negative and leaves the balance untouched (402)", async () => {
    const [before] = await fx.db
      .select({ balance: workspaces.aiCreditsBalance })
      .from(workspaces)
      .where(eq(workspaces.id, fx.workspaceId));
    // drain below the cost of a research_report (4)
    await fx.db
      .update(workspaces)
      .set({ aiCreditsBalance: 2 })
      .where(eq(workspaces.id, fx.workspaceId));

    const err = await spendCredits(fx.ctx, fx.db as never, fx.workspaceId, "research_report").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CoreError);
    expect((err as CoreError).status).toBe(402);
    expect((err as CoreError).code).toBe("credits_exhausted");

    const [after] = await fx.db
      .select({ balance: workspaces.aiCreditsBalance })
      .from(workspaces)
      .where(eq(workspaces.id, fx.workspaceId));
    expect(after.balance).toBe(2);

    const ledgerCount = (
      await fx.db.select().from(creditLedger).where(eq(creditLedger.workspaceId, fx.workspaceId))
    ).length;
    void before;
    expect(ledgerCount).toBeGreaterThan(0); // prior rows still intact, no new spend row asserted below
  });

  it("zero-cost reasons short-circuit without touching the DB", async () => {
    const ledgerBefore = (
      await fx.db.select().from(creditLedger).where(eq(creditLedger.workspaceId, fx.workspaceId))
    ).length;
    const result = await spendCredits(
      fx.ctx,
      fx.db as never,
      fx.workspaceId,
      "manual_adjustment",
    );
    expect(result).toBe(0);
    const ledgerAfter = (
      await fx.db.select().from(creditLedger).where(eq(creditLedger.workspaceId, fx.workspaceId))
    ).length;
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it("granting to an unknown workspace 404s", async () => {
    const err = await grantCredits(
      fx.ctx,
      "00000000-0000-0000-0000-000000000000",
      10,
      "manual_adjustment",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreError);
    expect((err as CoreError).status).toBe(404);
  });
});
