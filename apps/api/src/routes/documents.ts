import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createDocumentFromLinkSchema } from "@copyr/contracts";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  app.get("/documents", async (req) => {
    const query = z
      .object({ companyId: z.string().uuid().optional(), dealId: z.string().uuid().optional() })
      .parse(req.query);
    return { items: await core().documents.listDocuments(core().ctx, req.session!, query) };
  });

  /** Multipart upload — one or many `file` parts. */
  app.post("/documents/upload", async (req) => {
    const query = req.query as { companyId?: string; dealId?: string };
    const created = [];
    for await (const part of req.files()) {
      if (!part.file) continue;
      const buffer = await part.toBuffer();
      const doc = await core().documents.uploadDocument(core().ctx, req.session!, {
        name: part.filename,
        mime: part.mimetype || "application/pdf",
        content: buffer,
        companyId: query.companyId,
        dealId: query.dealId,
        source: "upload",
      });
      await core().ctx.enqueue("parse-document", {
        workspaceId: req.session!.workspaceId,
        documentId: doc.id,
      });
      created.push(doc);
    }
    return { items: created };
  });

  /** Paste a DocSend/Pitch/etc link → queued for conversion to permanent PDF. */
  app.post("/documents/from-link", async (req) => {
    const input = createDocumentFromLinkSchema.parse(req.body);
    return core().documents.createDocumentFromLink(core().ctx, req.session!, input);
  });

  app.get("/documents/:id/download-url", async (req) => {
    return core().documents.getDownloadUrl(core().ctx, req.session!, (req.params as { id: string }).id);
  });

  app.delete("/documents/:id", async (req) => {
    await core().documents.deleteDocument(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });
};

export default routes;
