import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAgentSchema, runAgentSchema, updateAgentSchema } from "@copyr/contracts";

const uuid = z.string().uuid();

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/agents", async (req) => core().agents.listAgents(core().ctx, req.session!));

  app.post("/agents", async (req) => {
    const input = createAgentSchema.parse(req.body);
    return core().agents.createAgent(core().ctx, req.session!, input);
  });

  /** Runs list is matched before :id — keep this route declared above /agents/:id. */
  app.get("/agents/runs", async (req) => {
    const q = z
      .object({
        agentId: uuid.optional(),
        companyId: uuid.optional(),
        status: z.enum(["queued", "running", "completed", "failed"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query ?? {});
    return core().agents.listRuns(core().ctx, req.session!, q);
  });

  app.get("/agents/runs/:runId", async (req) => {
    const { runId } = z.object({ runId: uuid }).parse(req.params);
    return core().agents.getRun(core().ctx, req.session!.workspaceId, runId);
  });

  app.get("/agents/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return core().agents.getAgent(core().ctx, req.session!, id);
  });

  app.patch("/agents/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const patch = updateAgentSchema.parse(req.body ?? {});
    return core().agents.updateAgent(core().ctx, req.session!, id, patch);
  });

  /** Queue a run — the agent executes end-to-end and returns review-ready output. */
  app.post("/agents/:id/runs", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = runAgentSchema.parse(req.body ?? {});
    return core().agents.queueAgentRun(core().ctx, req.session!, id, input);
  });
};

export default routes;
