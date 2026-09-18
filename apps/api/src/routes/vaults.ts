import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createReviewTableSchema,
  createVaultSchema,
  updateVaultSchema,
} from "@copyr/contracts";

const uuid = z.string().uuid();

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/vaults", async (req) => core().vaults.listVaults(core().ctx, req.session!));

  app.post("/vaults", async (req) => {
    const input = createVaultSchema.parse(req.body);
    return core().vaults.createVault(core().ctx, req.session!, input);
  });

  app.get("/vaults/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return core().vaults.getVaultDetail(core().ctx, req.session!, id);
  });

  app.patch("/vaults/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const patch = updateVaultSchema.parse(req.body ?? {});
    return core().vaults.updateVault(core().ctx, req.session!, id, patch);
  });

  app.delete("/vaults/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await core().vaults.deleteVault(core().ctx, req.session!, id);
    return { ok: true };
  });

  /** Attach existing documents and/or upload new ones straight into the vault. */
  app.post("/vaults/:id/documents", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = z
      .object({
        documentIds: z.array(uuid).optional(),
        upload: z
          .array(
            z.object({
              name: z.string(),
              mime: z.string().optional(),
              contentBase64: z.string(),
            }),
          )
          .optional(),
      })
      .parse(req.body ?? {});
    return core().vaults.addDocumentsToVault(core().ctx, req.session!, id, input);
  });

  app.delete("/vaults/:id/documents/:documentId", async (req) => {
    const { id, documentId } = z.object({ id: uuid, documentId: uuid }).parse(req.params);
    await core().vaults.removeDocumentFromVault(core().ctx, req.session!, id, documentId);
    return { ok: true };
  });

  /** Queue a structured review table across every parsed doc in the vault. */
  app.post("/vaults/:id/review-tables", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = createReviewTableSchema.parse({ ...(req.body as object), vaultId: id });
    return core().vaults.createReviewTable(core().ctx, req.session!, body);
  });

  app.get("/review-tables/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return core().vaults.getReviewTable(core().ctx, req.session!, id);
  });
};

export default routes;
