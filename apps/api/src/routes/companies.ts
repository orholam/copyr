import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createCompanySchema,
  updateCompanySchema,
  listCompaniesQuerySchema,
} from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/companies", async (req) => {
    const query = listCompaniesQuerySchema.parse(req.query);
    const { sector, ...rest } = query;
    return core().companies.listCompanies(core().ctx, req.session!, { ...rest, sector: sector ?? undefined });
  });

  app.get("/companies/:id", async (req) => {
    return core().companies.getCompany(core().ctx, req.session!, (req.params as { id: string }).id);
  });

  app.post("/companies", async (req) => {
    const input = createCompanySchema.parse(req.body);
    return core().companies.createCompany(core().ctx, req.session!, input);
  });

  app.patch("/companies/:id", async (req) => {
    const input = updateCompanySchema.parse(req.body);
    return core().companies.updateCompany(core().ctx, req.session!, (req.params as { id: string }).id, input);
  });

  app.delete("/companies/:id", async (req) => {
    await core().companies.deleteCompany(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/companies/:id/contacts", async (req) => {
    return core().companies.listContacts(core().ctx, req.session!, (req.params as { id: string }).id);
  });

  app.get("/companies/:id/relationships", async (req) => {
    return core().companies.listCompanyRelationships(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
    );
  });

  app.post("/companies/:id/merge", async (req) => {
    const input = z
      .object({ intoCompanyId: z.string().uuid() })
      .parse(req.body);
    return core().companies.mergeCompany(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
      input.intoCompanyId,
    );
  });
};

export default routes;
