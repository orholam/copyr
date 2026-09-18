import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { inboundEmailPayload, emailStatusSchema } from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;
  const config = () => (app as unknown as { core: import("@copyr/core").Core }).core.ctx.config;

  /* ── inbox (workspace-scoped) ─────────────────────────────────── */
  app.get("/emails", async (req) => {
    const query = z
      .object({
        status: emailStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return core().emails.listEmails(core().ctx, req.session!, query);
  });

  app.get("/emails/:id", async (req) => {
    return core().emails.getEmail(core().ctx, req.session!, (req.params as { id: string }).id);
  });

  app.post("/emails/:id/reprocess", async (req) => {
    await core().emails.reprocessEmail(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });

  /** Dev helper: fabricate a realistic pitch email and run it through the pipeline. */
  app.post("/emails/simulate", async (req) => {
    const input = z
      .object({
        companyName: z.string().min(1),
        founderName: z.string().default("Alex Founder"),
        round: z.string().default("Seed"),
        askUsd: z.number().default(4_000_000),
        arrUsd: z.number().optional(),
        sectorHint: z.string().optional(),
        withDeck: z.boolean().default(true),
        bulkCompanies: z.array(z.string().min(1)).max(200).optional(),
      })
      .parse(req.body);

    const deckText = [
      input.companyName,
      `${input.companyName} is building the future of ${input.sectorHint ?? "software"}.`,
      `We are raising $${Math.round(input.askUsd / 1e6)}M ${input.round}.`,
      input.arrUsd ? `ARR of $${(input.arrUsd / 1e6).toFixed(1)}M growing 150% YoY.` : "",
      "Team of 12 people based in San Francisco. Founded in 2023.",
    ]
      .filter(Boolean)
      .join("\n");

    let attachments: Array<{ filename: string; mime: string; contentBase64: string }> = [];
    if (input.withDeck) {
      attachments = [
        {
          filename: `${input.companyName.toLowerCase()}-${input.round.toLowerCase()}.pdf`,
          mime: "application/pdf",
          contentBase64: Buffer.from(`deck:${input.companyName}`).toString("base64"),
        },
      ];
    }

    // NOTE: withDeck uses a fake base64 that is NOT a real PDF; the parse job
    // will mark it failed gracefully. Pass a real PDF via /documents/upload
    // or the inbound webhook for full parsing.
    void deckText;

    const payload = {
      messageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2)}@copyr.dev`,
      from: { email: `founder@${input.companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`, name: input.founderName },
      to: ["deals@harbor.vc"],
      subject: `Pitch: ${input.companyName} ${input.round}`,
      text: `Hi,\n\nAttached is our deck. We are raising $${Math.round(input.askUsd / 1e6)}M ${input.round}.${
        input.arrUsd ? ` Current ARR is $${(input.arrUsd / 1e6).toFixed(1)}M growing 150% YoY.` : ""
      }\n\nTeam of 12 based in San Francisco. Founded in 2023.\n\n— ${input.founderName}`,
      attachments: input.withDeck
        ? await Promise.all(
            attachments.map(async (att) => ({
              ...att,
              contentBase64: (
                await import("@copyr/core")
              ).makePdf(
                `${input.companyName} — ${input.round} Deck`,
                `${input.companyName}\nRaising $${Math.round(input.askUsd / 1e6)}M ${input.round}.\n${
                  input.arrUsd ? `ARR $${(input.arrUsd / 1e6).toFixed(1)}M, +150% YoY.\n` : ""
                }Team of 12. Founded 2023. Based in San Francisco.\nSector: ${input.sectorHint ?? "software"}.`,
              ).toString("base64"),
            })),
          )
        : [],
    };

    if (input.bulkCompanies?.length) {
      payload.subject = `Deal dump — ${input.bulkCompanies.length} companies`;
      payload.text =
        `Forwarding a batch of intros:\n\n` +
        input.bulkCompanies.map((n) => `Intro to ${n} — raising seed. Deck attached separately.`).join("\n");
      payload.attachments = [];
    }
    const email = await core().emails.ingestEmail(core().ctx, req.session!.workspaceId, payload);
    return email;
  });

  /* ── inbound webhook (Mailpit forwarder / SES parity) ─────────── */
  app.post("/webhooks/inbound-email", async (req, reply) => {
    const secret =
      (req.headers["x-webhook-secret"] as string | undefined) ??
      new URL(req.url, "http://x").searchParams.get("secret") ??
      undefined;
    if (secret !== config().INBOUND_WEBHOOK_SECRET) {
      return reply.status(401).send({ error: "bad webhook secret" });
    }
    const payload = inboundEmailPayload.parse(req.body);
    const slug = new URL(req.url, "http://x").searchParams.get("workspace");
    const { resolveSession } = await import("@copyr/core");
    const session = await resolveSession(core().ctx, { workspaceSlug: slug, allowSlug: true });
    const email = await core().emails.ingestEmail(core().ctx, session.workspaceId, payload);
    return reply.status(202).send({ id: email.id, status: email.processingStatus });
  });
};

export default routes;
