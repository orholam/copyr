import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { askResearchSchema } from "@copyr/contracts";

const uuid = z.string().uuid();

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /** Grounded Q&A over the workspace corpus — cited, persisted, credit-metered. */
  app.post("/research/ask", async (req) => {
    const input = askResearchSchema.parse(req.body ?? {});
    return core().research.ask(core().ctx, req.session!, input);
  });

  app.get("/research/reports", async (req) => {
    const q = z
      .object({
        companyId: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query ?? {});
    return core().research.listReports(core().ctx, req.session!, q);
  });

  app.get("/research/reports/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return core().research.getReport(core().ctx, req.session!, id);
  });
};

export default routes;
