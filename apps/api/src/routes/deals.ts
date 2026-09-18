import type { FastifyPluginAsync } from "fastify";
import {
  createDealSchema,
  updateDealSchema,
  listDealsQuerySchema,
  moveDealSchema,
} from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/deals", async (req) => {
    const query = listDealsQuerySchema.parse(req.query);
    return core().deals.listDeals(core().ctx, req.session!, query);
  });

  app.get("/deals/:id", async (req) => {
    return core().deals.getDeal(core().ctx, req.session!, (req.params as { id: string }).id);
  });

  app.post("/deals", async (req) => {
    const input = createDealSchema.parse(req.body);
    return core().deals.createDeal(core().ctx, req.session!, input);
  });

  app.patch("/deals/:id", async (req) => {
    const input = updateDealSchema.parse(req.body);
    return core().deals.updateDeal(core().ctx, req.session!, (req.params as { id: string }).id, input);
  });

  /** Kanban drag-and-drop endpoint. */
  app.post("/deals/:id/move", async (req) => {
    const input = moveDealSchema.parse(req.body);
    return core().deals.moveDeal(core().ctx, req.session!, (req.params as { id: string }).id, input);
  });
};

export default routes;
