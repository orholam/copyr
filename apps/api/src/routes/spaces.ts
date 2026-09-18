import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { addParticipantSchema, createSpaceSchema, createTaskSchema, updateTaskSchema } from "@copyr/contracts";

const uuid = z.string().uuid();

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/spaces", async (req) => core().spaces.listSpaces(core().ctx, req.session!));

  app.post("/spaces", async (req) => {
    const input = createSpaceSchema.parse(req.body ?? {});
    return core().spaces.createSpace(core().ctx, req.session!, input);
  });

  /** The full context bundle: company, docs, notes, updates, tasks, activity. */
  app.get("/spaces/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return core().spaces.getSpace(core().ctx, req.session!, id);
  });

  app.post("/spaces/:id/participants", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = addParticipantSchema.parse(req.body ?? {});
    return core().spaces.addParticipant(core().ctx, req.session!, id, input);
  });

  app.get("/tasks", async (req) => {
    const q = z
      .object({ spaceId: uuid.optional(), status: z.enum(["open", "in_progress", "done"]).optional() })
      .parse(req.query ?? {});
    return core().spaces.listTasks(core().ctx, req.session!, q);
  });

  app.post("/tasks", async (req) => {
    const input = createTaskSchema.parse(req.body ?? {});
    return core().spaces.createTask(core().ctx, req.session!, input);
  });

  app.patch("/tasks/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const patch = updateTaskSchema.parse(req.body ?? {});
    return core().spaces.updateTask(core().ctx, req.session!, id, patch);
  });
};

export default routes;
