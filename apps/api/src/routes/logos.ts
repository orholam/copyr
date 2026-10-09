import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/logos/search", async (req) => {
    const query = z
      .object({
        q: z.string().min(2).max(80),
        method: z.enum(["match", "typeahead"]).default("typeahead"),
        limit: z.coerce.number().int().min(1).max(10).default(6),
      })
      .parse(req.query);
    const items = await core().logos.searchLogos(query.q, query.method, query.limit);
    return { items };
  });
};

export default routes;
