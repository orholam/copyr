import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createShareLinkSchema,
  updateShareLinkSchema,
  formSubmissionSchema,
} from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /* ── share links (authenticated) ─────────────────────────────── */
  app.get("/share-links", async (req) => {
    return core().sharing.listShareLinks(core().ctx, req.session!);
  });

  app.post("/share-links", async (req) => {
    const input = createShareLinkSchema.parse(req.body);
    return core().sharing.createShareLink(core().ctx, req.session!, input);
  });

  app.patch("/share-links/:id", async (req) => {
    const input = updateShareLinkSchema.parse(req.body);
    const id = (req.params as { id: string }).id;
    return core().sharing.updateShareLink(core().ctx, req.session!, id, {
      title: input.title,
      attributes: input.attributes,
      includeDocuments: input.includeDocuments,
      password: input.password ?? undefined,
      expiresAt: input.expiresAt ?? undefined,
      revoked: input.revoked,
    });
  });

  app.delete("/share-links/:id", async (req) => {
    await core().sharing.deleteShareLink(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/share-links/:id/views", async (req) => {
    return core().sharing.listShareViews(core().ctx, req.session!, (req.params as { id: string }).id);
  });

  /* ── public share view (no auth; token is the credential) ────── */
  app.get("/public/share/:token", async (req, reply) => {
    const query = z.object({ password: z.string().optional() }).parse(req.query ?? {});
    try {
      return await core().sharing.resolvePublicShare(core().ctx, (req.params as { token: string }).token, {
        password: query.password,
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "expired" || code === "revoked") {
        return reply.status(410).send({ error: "link no longer available", code });
      }
      throw err;
    }
  });

  /* ── public intake form (website → pipeline) ─────────────────── */
  app.get("/public/forms/:slug", async (req) => {
    const form = await core().session.getIntakeFormBySlug(core().ctx, (req.params as { slug: string }).slug);
    return {
      name: form.name,
      slug: form.slug,
      fields: form.fields,
    };
  });

  app.post("/public/forms/:slug", async (req) => {
    const submission = formSubmissionSchema.parse(req.body);
    const clean = Object.fromEntries(
      Object.entries(submission).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    return core().session.submitIntakeForm(core().ctx, (req.params as { slug: string }).slug, clean);
  });
};

export default routes;
