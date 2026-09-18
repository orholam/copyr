import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createNoteSchema, createPortfolioUpdateSchema } from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /* ── notes ─────────────────────────────────────────────────────── */
  app.get("/notes", async (req) => {
    const query = z
      .object({ companyId: z.string().uuid().optional(), dealId: z.string().uuid().optional() })
      .parse(req.query);
    return core().content.listNotes(core().ctx, req.session!, query);
  });

  app.post("/notes", async (req) => {
    const input = createNoteSchema.parse(req.body);
    return core().content.addNote(core().ctx, req.session!, input);
  });

  app.delete("/notes/:id", async (req) => {
    await core().content.deleteNote(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });

  /* ── activity feed / entity timeline ───────────────────────────── */
  app.get("/activity", async (req) => {
    const query = z
      .object({
        entityType: z.string().optional(),
        entityId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        dealId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return core().content.listActivity(core().ctx, req.session!, query);
  });

  /* ── portfolio updates ─────────────────────────────────────────── */
  app.get("/portfolio-updates", async (req) => {
    const query = z
      .object({
        companyId: z.string().uuid().optional(),
        kind: z.enum(["milestone", "metric", "hiring", "funding", "news", "update"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return core().content.listPortfolioUpdates(core().ctx, req.session!, query);
  });

  app.post("/portfolio-updates", async (req) => {
    const input = createPortfolioUpdateSchema.parse(req.body);
    return core().content.createPortfolioUpdate(core().ctx, req.session!, input);
  });
};

export default routes;
