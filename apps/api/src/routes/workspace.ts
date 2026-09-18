import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { grantCredits } from "@copyr/core";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/me", async (req) => {
    const ws = await core().session.getWorkspace(core().ctx, req.session!.workspaceId);
    return { workspace: ws, actor: req.session!.actor };
  });

  /* ── credits ─────────────────────────────────────────────────── */
  app.get("/credits", async (req) => {
    const ledger = await core().session.listCreditLedger(core().ctx, req.session!.workspaceId);
    const ws = await core().session.getWorkspace(core().ctx, req.session!.workspaceId);
    return { balance: ws.aiCreditsBalance, ledger };
  });

  app.post("/credits/grant", async (req) => {
    const input = z
      .object({ amount: z.number().int().min(1).max(100_000), reason: z.enum(["monthly_grant", "manual_adjustment"]).default("manual_adjustment") })
      .parse(req.body);
    const balance = await grantCredits(core().ctx, req.session!.workspaceId, input.amount, input.reason);
    return { balance };
  });

  /** Pay-as-you-go top-up (ToS 6.3 parity). Stripe checkout wires in at billing phase. */
  app.post("/credits/purchase", async (req) => {
    const input = z
      .object({
        pack: z.enum(["starter", "team", "scale"]).default("starter"),
      })
      .parse(req.body);
    const packs = { starter: 500, team: 2000, scale: 6000 } as const;
    const amount = packs[input.pack];
    const balance = await grantCredits(
      core().ctx,
      req.session!.workspaceId,
      amount,
      "manual_adjustment",
    );
    return {
      balance,
      purchased: amount,
      // real Stripe Checkout session URL arrives with the billing milestone
      stripeCheckoutUrl: null as string | null,
    };
  });

  /* ── data export (privacy 6.3 parity) ────────────────────────── */
  app.get("/export/deals", async (req, reply) => {
    const q = z.object({ format: z.enum(["csv", "json"]).default("csv") }).parse(req.query);
    const file = await core().intelligence.exportDeals(core().ctx, req.session!, q.format);
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  });

  /* ── AI investment thesis (ToS 2.1 parity) ───────────────────── */
  app.post("/companies/:id/thesis", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return core().intelligence.generateThesis(core().ctx, req.session!, id);
  });

  /* ── browser-extension / external capture (ToS 4.3 parity) ──── */
  app.post("/capture", async (req) => {
    const input = z
      .object({
        url: z.string().url(),
        title: z.string().max(300).optional(),
        note: z.string().max(4000).optional(),
        screenshotBase64: z.string().optional(),
        createDeal: z.boolean().default(true),
      })
      .parse(req.body);
    return core().intelligence.capturePage(core().ctx, req.session!, input);
  });

  /* ── API keys (agent access) ─────────────────────────────────── */
  app.get("/api-keys", async (req) => core().session.listApiKeys(core().ctx, req.session!));

  app.post("/api-keys", async (req) => {
    const input = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    return core().session.createApiKey(core().ctx, req.session!, input.name);
  });

  app.delete("/api-keys/:id", async (req) => {
    await core().session.revokeApiKey(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });

  /* ── intake forms ────────────────────────────────────────────── */
  app.get("/intake-forms", async (req) => {
    const rows = await core().session.listIntakeForms(core().ctx, req.session!);
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        isActive: r.isActive,
        fields: r.fields,
        publicUrl: `${core().ctx.config.PUBLIC_URL}/api/v1/public/forms/${r.slug}`,
      })),
    };
  });

  app.post("/intake-forms", async (req) => {
    const input = z
      .object({ name: z.string().min(1).max(80), landingStageId: z.string().uuid().optional() })
      .parse(req.body);
    const row = await core().session.createIntakeForm(core().ctx, req.session!, input);
    return { id: row.id, name: row.name, slug: row.slug };
  });
};

export default routes;
