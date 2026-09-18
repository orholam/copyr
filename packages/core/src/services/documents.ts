import { and, desc, eq, sql } from "drizzle-orm";
import { documents, companies } from "@copyr/db/schema.js";
import type { DocumentDto } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { mapDocument } from "../mappers.js";
import { logActivity } from "../activity.js";
import { nextStagePosition } from "./companies.js";
import { resolvePipelineStage } from "./pipelines.js";

export async function listDocuments(
  ctx: CoreContext,
  session: Session,
  filter: { companyId?: string; dealId?: string },
): Promise<DocumentDto[]> {
  const conds = [eq(documents.workspaceId, session.workspaceId)];
  if (filter.companyId) conds.push(eq(documents.companyId, filter.companyId));
  if (filter.dealId) conds.push(eq(documents.dealId, filter.dealId));
  const rows = await ctx.db
    .select()
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.createdAt));
  return rows.map(mapDocument);
}

export async function getDocumentRow(
  ctx: CoreContext,
  exec: CoreContext["db"] | Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0],
  workspaceId: string,
  documentId: string,
) {
  const [row] = await exec
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)));
  if (!row) throw new CoreError("document not found", { status: 404 });
  return row;
}

/** Store bytes + create row (status pending). Caller enqueues parse job. */
export interface UploadDocumentInput {
  name: string;
  mime?: string;
  content: Buffer;
  companyId?: string;
  dealId?: string;
  source?: "upload" | "link_conversion" | "email_attachment";
  sourceUrl?: string;
  createdByUserId?: string | null;
}

export async function uploadDocument(
  ctx: CoreContext,
  session: Session,
  input: UploadDocumentInput,
): Promise<DocumentDto> {
  // attach to company's latest open deal when only company known
  const companyId = input.companyId ?? null;
  const dealId = input.dealId ?? input.companyId ?? null;

  const key = `workspaces/${session.workspaceId}/documents/${crypto.randomUUID()}.pdf`;
  await ctx.storage.put(key, input.content, input.mime ?? "application/pdf");

  const [row] = await ctx.db
    .insert(documents)
    .values({
      workspaceId: session.workspaceId,
      companyId,
      dealId,
      name: input.name,
      mime: input.mime ?? "application/pdf",
      sizeBytes: input.content.byteLength,
      storageKey: key,
      sourceUrl: input.sourceUrl ?? null,
      source: input.source ?? "upload",
      parseStatus: "pending",
      createdByUserId: input.createdByUserId ?? session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "document",
    entityId: row.id,
    companyId,
    dealId,
    type: "document.created",
    summary: `Document "${row.name}" uploaded`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  return mapDocument(row);
}

export async function getDownloadUrl(
  ctx: CoreContext,
  session: Session,
  documentId: string,
): Promise<{ url: string; name: string; mime: string }> {
  const row = await getDocumentRow(ctx, ctx.db, session.workspaceId, documentId);
  if (!row.storageKey) throw new CoreError("document file not available yet", { code: "not_ready", status: 409 });
  const url = await ctx.storage.signedUrl(row.storageKey, 900);
  return { url, name: row.name, mime: row.mime };
}

export async function deleteDocument(
  ctx: CoreContext,
  session: Session,
  documentId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(documents)
    .where(and(eq(documents.id, documentId), eq(documents.workspaceId, session.workspaceId)))
    .returning({ id: documents.id });
  if (!deleted.length) throw new CoreError("document not found", { status: 404 });
}

/** Queue a DocSend/Pitch/etc link for conversion into a permanent PDF. */
export async function createDocumentFromLink(
  ctx: CoreContext,
  session: Session,
  input: { url: string; companyId?: string; dealId?: string; companyName?: string },
): Promise<{ id: string; status: "queued_for_conversion" }> {
  const { documents } = await import("@copyr/db/schema.js");
  let companyId = input.companyId ?? null;

  if (!companyId && !input.dealId && input.companyName) {
    const existing = await ctx.db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.workspaceId, session.workspaceId), sql`lower(${companies.name}) = lower(${input.companyName})`))
      .limit(1);
    if (existing[0]) companyId = existing[0].id;
    else {
      const { pipelineId, stage } = await resolvePipelineStage(ctx, ctx.db, session.workspaceId);
      const position = await nextStagePosition(ctx.db, stage.id);
      const created = await ctx.db
        .insert(companies)
        .values({
          workspaceId: session.workspaceId,
          name: input.companyName,
          domain: new URL(input.url).hostname.replace(/^www\./, ""),
          source: "link",
          pipelineId,
          stageId: stage.id,
          position,
        })
        .returning({ id: companies.id });
      companyId = created[0]!.id;
    }
  }

  const host = new URL(input.url).hostname.replace(/^www\./, "");
  const [doc] = await ctx.db
    .insert(documents)
    .values({
      workspaceId: session.workspaceId,
      companyId,
      dealId: input.dealId ?? companyId,
      name: `${host} deck`,
      sourceUrl: input.url,
      source: "link_conversion",
      parseStatus: "pending",
      storageKey: "",
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "document",
    entityId: doc.id,
    companyId,
    dealId: input.dealId ?? null,
    type: "document.created",
    summary: `Link queued for conversion: ${input.url}`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  await ctx.enqueue("convert-link", { workspaceId: session.workspaceId, documentId: doc.id });
  return { id: doc.id, status: "queued_for_conversion" };
}
