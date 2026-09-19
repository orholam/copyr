import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { companies } from "@copyr/db/schema.js";
import { createCompany } from "./companies.js";
import { createDeal, listDeals } from "./deals.js";
import { cleanupWorkspace, getTestDb, seedWorkspace, type WsFixture } from "../test-db.js";
import type { Session } from "../context.js";

const db = await getTestDb();

describe.skipIf(db === null)("companies are pipeline cards", () => {
  let fx: WsFixture;
  let session: Session;

  beforeAll(async () => {
    fx = await seedWorkspace(db!);
    session = { workspaceId: fx.workspaceId, actor: { userId: fx.userIds.owner, source: "api" } };
  });

  afterAll(async () => {
    await cleanupWorkspace(fx);
  });

  it("createCompany places the company on the default first stage", async () => {
    const company = await createCompany(fx.ctx, session, { name: `OpenAI-${fx.workspaceSlug}` });
    expect(company.pipelineId).toBe(fx.pipelineId);
    expect(company.stageId).toBe(fx.stageIds.sourcing);

    const [row] = await fx.db.select().from(companies).where(eq(companies.id, company.id));
    expect(row.stageId).toBe(fx.stageIds.sourcing);

    const listed = await listDeals(fx.ctx, session, {
      archived: "false",
      sort: "position",
      order: "asc",
      limit: 200,
      offset: 0,
    });
    expect(listed.items.some((d) => d.id === company.id && d.companyId === company.id)).toBe(true);
  });

  it("createDeal with companyName reuses the company and shares its id", async () => {
    const name = `Anthropic-${fx.workspaceSlug}`;
    const first = await createDeal(fx.ctx, session, { companyName: name, priority: 0 });
    expect(first.companyCreated).toBe(true);
    expect(first.id).toBe(first.companyId);

    const second = await createDeal(fx.ctx, session, { companyName: name, roundStage: "Series A", priority: 0 });
    expect(second.companyCreated).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.roundStage).toBe("Series A");
  });
});
