import type { FastifyPluginAsync } from "fastify";
import { globalSearchQuerySchema } from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/analytics/overview", async (req) => {
    return core().analytics.analyticsOverview(core().ctx, req.session!);
  });

  app.get("/search", async (req) => {
    const query = globalSearchQuerySchema.parse(req.query);
    return core().analytics.globalSearch(core().ctx, req.session!, query.q, query.limit);
  });
};

export default routes;
