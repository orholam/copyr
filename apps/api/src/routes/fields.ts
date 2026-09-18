import type { FastifyPluginAsync } from "fastify";
import { createCustomFieldSchema, updateCustomFieldSchema } from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/custom-fields", async (req) => {
    return core().fields.listCustomFields(core().ctx, req.session!);
  });

  app.post("/custom-fields", async (req) => {
    const input = createCustomFieldSchema.parse(req.body);
    return core().fields.createCustomField(core().ctx, req.session!, input);
  });

  app.patch("/custom-fields/:id", async (req) => {
    const input = updateCustomFieldSchema.parse(req.body);
    return core().fields.updateCustomField(core().ctx, req.session!, (req.params as { id: string }).id, input);
  });

  app.delete("/custom-fields/:id", async (req) => {
    await core().fields.deleteCustomField(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });
};

export default routes;
