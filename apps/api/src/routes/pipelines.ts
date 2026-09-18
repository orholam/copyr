import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/pipelines", async (req) => {
    return core().pipelines.listPipelines(core().ctx, req.session!);
  });

  app.post("/stages", async (req) => {
    const input = z
      .object({
        pipelineId: z.string().uuid().optional(),
        name: z.string().min(1).max(80),
        color: z.string().default("#6366f1"),
        kind: z.enum(["active", "won", "lost"]).default("active"),
      })
      .parse(req.body);
    return core().pipelines.createStage(core().ctx, req.session!, input);
  });

  app.patch("/stages/:id", async (req) => {
    const input = z
      .object({
        name: z.string().min(1).max(80).optional(),
        color: z.string().optional(),
        kind: z.enum(["active", "won", "lost"]).optional(),
      })
      .parse(req.body);
    return core().pipelines.updateStage(core().ctx, req.session!, (req.params as { id: string }).id, input);
  });

  app.delete("/stages/:id", async (req) => {
    await core().pipelines.deleteStage(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });
};

export default routes;
