import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertPermission } from "@copyr/core";

/** Saved pipeline views — owned by the automation workstream. */
const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/views", async (req) => {
    return core().automation.listSavedViews(core().ctx, req.session!);
  });

  app.post("/views", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_pipeline");
    const input = z
      .object({ name: z.string().min(1).max(80), query: z.record(z.string(), z.string()).default({}) })
      .parse(req.body);
    return core().automation.createSavedView(core().ctx, req.session!, input);
  });

  app.delete("/views/:id", async (req) => {
    await core().automation.deleteSavedView(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });

  /** Machine-readable API contract for agents & integrations. */
  app.get("/openapi.json", async (_req, reply) => {
    const { buildOpenApi } = await import("../openapi.js");
    reply.header("content-type", "application/json");
    return buildOpenApi();
  });
};

export default routes;
