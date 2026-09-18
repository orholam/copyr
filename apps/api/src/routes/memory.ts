import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createMemorySchema } from "@copyr/contracts";

const uuid = z.string().uuid();

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /** Everything the AI remembers about this fund/partner — inspectable. */
  app.get("/memory", async (req) => {
    const q = z
      .object({
        userId: uuid.nullable().optional(),
        kind: z.enum(["preference", "focus_area", "process", "fact"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(req.query ?? {});
    return {
      items: await core().memory.listMemories(core().ctx, req.session!, q),
    };
  });

  app.post("/memory", async (req) => {
    const input = createMemorySchema.parse(req.body ?? {});
    return core().memory.remember(core().ctx, req.session!, input);
  });

  app.delete("/memory/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await core().memory.forget(core().ctx, req.session!, id);
    return { ok: true };
  });
};

export default routes;
