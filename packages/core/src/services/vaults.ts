import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  documents,
  reviewRows,
  reviewTables,
  vaultDocuments,
  vaults,
} from "@copyr/db/schema.js";
import type {
  CreateReviewTableInput,
  CreateVaultInput,
  ReviewColumn,
  ReviewRowDto,
  ReviewTableDto,
  VaultDto,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { toIso } from "../mappers.js";

/* ── vaults ────────────────────────────────────────────────────────── */

export async function createVault(
  ctx: CoreContext,
  session: Session,
  input: CreateVaultInput,
): Promise<VaultDto> {
  const [row] = await ctx.db
    .insert(vaults)
    .values({
      workspaceId: session.workspaceId,
      name: input.name,
      description: input.description ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "vault",
    entityId: row.id,
    companyId: row.companyId,
    dealId: row.dealId,
    type: "vault.created",
    summary: `Diligence vault "${row.name}" created`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });

  return mapVault(row, 0, 0, 0);
}

export async function listVaults(ctx: CoreContext, session: Session): Promise<VaultDto[]> {
  const rows = await ctx.db
    .select({
      vault: vaults,
      documentCount: sql<number>`count(distinct ${vaultDocuments.documentId})::int`,
      parsedCount: sql<number>`count(distinct case when ${documents.parseStatus} = 'parsed' then ${documents.id} end)::int`,
    })
    .from(vaults)
    .leftJoin(vaultDocuments, eq(vaultDocuments.vaultId, vaults.id))
    .leftJoin(documents, eq(documents.id, vaultDocuments.documentId))
    .where(eq(vaults.workspaceId, session.workspaceId))
    .groupBy(vaults.id)
    .orderBy(desc(vaults.createdAt));

  const tableCounts = await ctx.db
    .select({ vaultId: reviewTables.vaultId, count: sql<number>`count(*)::int` })
    .from(reviewTables)
    .where(eq(reviewTables.workspaceId, session.workspaceId))
    .groupBy(reviewTables.vaultId);
  const tablesByVault = new Map(tableCounts.map((t) => [t.vaultId, t.count]));

  return rows.map((r) =>
    mapVault(r.vault, r.documentCount ?? 0, r.parsedCount ?? 0, tablesByVault.get(r.vault.id) ?? 0),
  );
}

export async function getVaultDetail(
  ctx: CoreContext,
  session: Session,
  vaultId: string,
): Promise<{
  vault: VaultDto;
  documents: Awaited<ReturnType<typeof import("./documents.js").listDocuments>>;
  tables: ReviewTableDto[];
}> {
  const [row] = await ctx.db
    .select()
    .from(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, session.workspaceId)));
  if (!row) throw new CoreError("vault not found", { status: 404 });

  const docIds = await ctx.db
    .select({ documentId: vaultDocuments.documentId })
    .from(vaultDocuments)
    .where(eq(vaultDocuments.vaultId, vaultId));

  const docs = docIds.length
    ? await ctx.db
        .select()
        .from(documents)
        .where(inArray(documents.id, docIds.map((d) => d.documentId)))
        .orderBy(desc(documents.createdAt))
    : [];

  const tables = await listReviewTablesForVault(ctx, session, vaultId);
  const parsed = docs.filter((d) => d.parseStatus === "parsed").length;

  return {
    vault: mapVault(row, docs.length, parsed, tables.length),
    documents: docs.map((d) => ({
      id: d.id,
      companyId: d.companyId,
      dealId: d.dealId,
      name: d.name,
      mime: d.mime,
      sizeBytes: d.sizeBytes,
      pageCount: d.pageCount,
      sourceUrl: d.sourceUrl,
      source: d.source,
      parseStatus: d.parseStatus,
      createdAt: toIso(d.createdAt)!,
    })),
    tables,
  };
}

export async function updateVault(
  ctx: CoreContext,
  session: Session,
  vaultId: string,
  patch: { name?: string; description?: string | null; status?: "active" | "archived" },
): Promise<VaultDto> {
  const [row] = await ctx.db
    .update(vaults)
    .set(patch)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, session.workspaceId)))
    .returning();
  if (!row) throw new CoreError("vault not found", { status: 404 });
  return mapVault(row, 0, 0, 0);
}

export async function deleteVault(
  ctx: CoreContext,
  session: Session,
  vaultId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, session.workspaceId)))
    .returning({ id: vaults.id });
  if (!deleted.length) throw new CoreError("vault not found", { status: 404 });
}

/** Attach existing (or newly uploaded) documents to a vault. */
export async function addDocumentsToVault(
  ctx: CoreContext,
  session: Session,
  vaultId: string,
  input: { documentIds?: string[]; upload?: { name: string; mime?: string; contentBase64: string }[] },
): Promise<{ added: string[]; queuedForParse: string[] }> {
  const [vault] = await ctx.db
    .select()
    .from(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, session.workspaceId)));
  if (!vault) throw new CoreError("vault not found", { status: 404 });

  const added: string[] = [];
  const queuedForParse: string[] = [];
  const { uploadDocument } = await import("./documents.js");

  for (const documentId of input.documentIds ?? []) {
    const [doc] = await ctx.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, session.workspaceId)));
    if (!doc) continue;
    await ctx.db
      .insert(vaultDocuments)
      .values({ vaultId, documentId })
      .onConflictDoNothing();
    added.push(documentId);
  }

  for (const up of input.upload ?? []) {
    const doc = await uploadDocument(ctx, session, {
      name: up.name,
      mime: up.mime ?? "application/pdf",
      content: Buffer.from(up.contentBase64, "base64"),
      companyId: vault.companyId ?? undefined,
      dealId: vault.dealId ?? undefined,
      source: "upload",
    });
    await ctx.db.insert(vaultDocuments).values({ vaultId, documentId: doc.id }).onConflictDoNothing();
    added.push(doc.id);
    queuedForParse.push(doc.id);
  }

  if (added.length) {
    await logActivity(ctx, ctx.db, {
      workspaceId: session.workspaceId,
      entityType: "vault",
      entityId: vaultId,
      companyId: vault.companyId,
      dealId: vault.dealId,
      type: "vault.updated",
      summary: `${added.length} document(s) added to vault "${vault.name}"`,
      actor: session.actor.userId ? "user" : "ai",
      actorUserId: session.actor.userId,
    });
  }

  return { added, queuedForParse };
}

export async function removeDocumentFromVault(
  ctx: CoreContext,
  session: Session,
  vaultId: string,
  documentId: string,
): Promise<void> {
  await ctx.db
    .delete(vaultDocuments)
    .where(and(eq(vaultDocuments.vaultId, vaultId), eq(vaultDocuments.documentId, documentId)));
}

/* ── review tables ─────────────────────────────────────────────────── */

export async function createReviewTable(
  ctx: CoreContext,
  session: Session,
  input: CreateReviewTableInput,
): Promise<{ table: ReviewTableDto; runId?: string }> {
  const [vault] = await ctx.db
    .select()
    .from(vaults)
    .where(and(eq(vaults.id, input.vaultId), eq(vaults.workspaceId, session.workspaceId)));
  if (!vault) throw new CoreError("vault not found", { status: 404 });

  const [table] = await ctx.db
    .insert(reviewTables)
    .values({
      workspaceId: session.workspaceId,
      vaultId: input.vaultId,
      name: input.name,
      instruction: input.instruction ?? null,
      columns: input.columns,
      status: "pending",
      createdByUserId: session.actor.userId,
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "review_table",
    entityId: table.id,
    companyId: vault.companyId,
    dealId: vault.dealId,
    type: "review_table.created",
    summary: `Review table "${table.name}" queued over ${input.columns.length} column(s)`,
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
  });

  if (input.waitForCompletion) {
    await executeReviewTable(ctx, session.workspaceId, table.id);
    return { table: (await getReviewTable(ctx, session, table.id)).table };
  }

  await ctx.enqueue("run-review-table", {
    workspaceId: session.workspaceId,
    reviewTableId: table.id,
  });
  return { table: mapReviewTable(table, 0) };
}

async function listReviewTablesForVault(
  ctx: CoreContext,
  session: Session,
  vaultId: string,
): Promise<ReviewTableDto[]> {
  const rows = await ctx.db
    .select({
      table: reviewTables,
      rowCount: sql<number>`count(${reviewRows.id})::int`,
    })
    .from(reviewTables)
    .leftJoin(reviewRows, eq(reviewRows.reviewTableId, reviewTables.id))
    .where(and(eq(reviewTables.vaultId, vaultId), eq(reviewTables.workspaceId, session.workspaceId)))
    .groupBy(reviewTables.id)
    .orderBy(desc(reviewTables.createdAt));
  return rows.map((r) => mapReviewTable(r.table, r.rowCount ?? 0));
}

export async function getReviewTable(
  ctx: CoreContext,
  session: Session,
  reviewTableId: string,
): Promise<{ table: ReviewTableDto; rows: ReviewRowDto[] }> {
  const [table] = await ctx.db
    .select()
    .from(reviewTables)
    .where(and(eq(reviewTables.id, reviewTableId), eq(reviewTables.workspaceId, session.workspaceId)));
  if (!table) throw new CoreError("review table not found", { status: 404 });

  const rows = await ctx.db
    .select({ row: reviewRows, documentName: documents.name })
    .from(reviewRows)
    .leftJoin(documents, eq(documents.id, reviewRows.documentId))
    .where(eq(reviewRows.reviewTableId, reviewTableId))
    .orderBy(asc(reviewRows.rowIndex));

  return {
    table: mapReviewTable(table, rows.length),
    rows: rows.map(({ row, documentName }) => ({
      id: row.id,
      reviewTableId: row.reviewTableId,
      documentId: row.documentId,
      documentName: documentName ?? null,
      rowIndex: row.rowIndex,
      data: row.data ?? {},
      citations: row.citations ?? [],
      confidence: row.confidence === null ? null : Number(row.confidence),
      locked: row.locked,
    })),
  };
}

/**
 * The core Vault mechanic: one query across every parsed document in the
 * vault → structured rows with citations. Runs as a job or inline.
 */
export async function executeReviewTable(
  ctx: CoreContext,
  workspaceId: string,
  reviewTableId: string,
): Promise<void> {
  const [table] = await ctx.db
    .select()
    .from(reviewTables)
    .where(and(eq(reviewTables.id, reviewTableId), eq(reviewTables.workspaceId, workspaceId)));
  if (!table || table.status === "running") return;

  await ctx.db.update(reviewTables).set({ status: "running", error: null }).where(eq(reviewTables.id, table.id));

  let creditsUsed = 0;
  try {
    const docRows = await ctx.db
      .select({ id: documents.id, name: documents.name, textContent: documents.textContent })
      .from(vaultDocuments)
      .innerJoin(documents, eq(documents.id, vaultDocuments.documentId))
      .where(and(eq(vaultDocuments.vaultId, table.vaultId), eq(documents.parseStatus, "parsed")))
      .orderBy(desc(documents.createdAt));

    const usable = docRows.filter((d) => (d.textContent?.length ?? 0) > 20).slice(0, 200);

    // previous rows are replaced on rerun; locked rows survive (human-reviewed)
    await ctx.db.delete(reviewRows).where(and(eq(reviewRows.reviewTableId, table.id), eq(reviewRows.locked, false)));

    // spend credits once per reviewed document via the standard ledger path
    const { spendCredits } = await import("../credits.js");
    if (usable.length) {
      const output = await ctx.ai.extractTableRows({
        instruction: table.instruction,
        columns: table.columns as unknown as ReviewColumn[],
        documents: usable.map((d) => ({ id: d.id, name: d.name, text: (d.textContent ?? "").slice(0, 12_000) })),
      });

      const ordered = usable
        .map((doc) => output.rows.find((r) => r.documentId === doc.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));

      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < ordered.length; i++) {
          await spendCredits(ctx, tx as never, workspaceId, "vault_review", {
            refType: "review_table",
            refId: table.id,
          });
        }
      });
      creditsUsed = ordered.length * 3;

      await ctx.db.insert(reviewRows).values(
        ordered.map((r, idx) => ({
          reviewTableId: table.id,
          workspaceId,
          documentId: r.documentId,
          rowIndex: idx,
          data: sanitizeData(r.data),
          citations: (r.citations ?? []).slice(0, 4).map((quote) => ({ quote })),
          confidence: String(Math.round((r.confidence ?? 0.7) * 100) / 100),
        })),
      );
    }

    await ctx.db
      .update(reviewTables)
      .set({ status: "completed", creditsUsed, completedAt: new Date() })
      .where(eq(reviewTables.id, table.id));

    await logActivity(ctx, ctx.db, {
      workspaceId,
      entityType: "review_table",
      entityId: table.id,
      type: "review_table.completed",
      summary: `Review table "${table.name}" completed — ${usable.length} document(s) reviewed`,
      actor: "ai",
      data: { rows: usable.length, creditsUsed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db
      .update(reviewTables)
      .set({ status: "failed", error: message.slice(0, 500), completedAt: new Date() })
      .where(eq(reviewTables.id, table.id));
    await logActivity(ctx, ctx.db, {
      workspaceId,
      entityType: "review_table",
      entityId: table.id,
      type: "review_table.failed",
      summary: `Review table "${table.name}" failed: ${message.slice(0, 120)}`,
      actor: "system",
    });
  }
}

function sanitizeData(data: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

/* ── mappers ───────────────────────────────────────────────────────── */

type VaultRow = typeof vaults.$inferSelect;
type ReviewTableRow = typeof reviewTables.$inferSelect;

function mapVault(row: VaultRow, documentCount: number, parsedDocumentCount: number, reviewTableCount: number): VaultDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    companyId: row.companyId,
    dealId: row.dealId,
    status: row.status,
    documentCount,
    parsedDocumentCount,
    reviewTableCount,
    createdByUserId: row.createdByUserId,
    createdAt: toIso(row.createdAt)!,
  };
}

function mapReviewTable(row: ReviewTableRow, rowCount: number): ReviewTableDto {
  return {
    id: row.id,
    vaultId: row.vaultId,
    name: row.name,
    instruction: row.instruction,
    columns: (row.columns ?? []) as unknown as ReviewColumn[],
    status: row.status,
    error: row.error,
    creditsUsed: row.creditsUsed,
    rowCount,
    createdAt: toIso(row.createdAt)!,
    completedAt: toIso(row.completedAt),
  };
}
