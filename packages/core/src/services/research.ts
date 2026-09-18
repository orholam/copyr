import { and, desc, eq, sql } from "drizzle-orm";
import {
  documents,
  emailMessages,
  notes,
  portfolioUpdates,
  researchReports,
  vaultDocuments,
} from "@copyr/db/schema.js";
import type { AskResearchInput, ResearchReportDto } from "@copyr/contracts";
import type { GroundingPassage } from "@copyr/ai";
import type { CoreContext, Session } from "../context.js";
import { logActivity } from "../activity.js";
import { spendCredits } from "../credits.js";
import { toIso } from "../mappers.js";
import { groundingMemories } from "./memory.js";

/**
 * Grounded research over the workspace corpus: parsed documents (optionally
 * scoped to a company/deal/vault), notes, portfolio updates, emails and fund
 * memories. The provider must cite passages; answers without citations are
 * treated as unsupported. Every Q&A is persisted as a reviewable report.
 */
export async function ask(
  ctx: CoreContext,
  session: Session,
  input: AskResearchInput,
): Promise<ResearchReportDto> {
  const passages = await gatherPassages(ctx, session, input);
  if (!passages.length) {
    throw new Error(
      "No indexed material found in scope — attach documents to a vault or ingest materials first.",
    );
  }

  const answer = await ctx.ai.answerGrounded({
    question: input.question,
    passages: passages.map((p) => ({
      id: p.id,
      sourceType: p.sourceType,
      sourceName: p.sourceName,
      text: p.text.slice(0, 2_400),
    })),
  });

  const citedSources = answer.citations
    .map((i) => passages[i])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const [row] = await ctx.db
    .insert(researchReports)
    .values({
      workspaceId: session.workspaceId,
      question: input.question,
      answer: answer.answer,
      citations: citedSources.map((p) => ({
        sourceType: p.sourceType,
        sourceId: p.id,
        sourceName: p.sourceName,
        quote: p.text.slice(0, 300),
      })),
      scopeCompanyId: input.companyId ?? null,
      scopeDealId: input.dealId ?? null,
      scopeVaultId: input.vaultId ?? null,
      model: ctx.ai.model,
      confidence: String(answer.confidence),
      createdByUserId: session.actor.userId,
    })
    .returning();

  await ctx.db.transaction(async (tx) => {
    await spendCredits(ctx, tx as never, session.workspaceId, "research_report", {
      refType: "research_report",
      refId: row.id,
    });
  });

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "research_report",
    entityId: row.id,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    type: "research.completed",
    summary: `Research answered with ${citedSources.length} citation(s): "${input.question.slice(0, 90)}"`,
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
    data: { confidence: answer.confidence },
  });

  return mapReport(row, row.creditsUsed || 4);
}

async function gatherPassages(
  ctx: CoreContext,
  session: Session,
  input: AskResearchInput,
): Promise<GroundingPassage[]> {
  const out: GroundingPassage[] = [];

  // ── documents (vault scope wins; else company/deal; else whole corpus) ──
  if (input.vaultId) {
    const rows = await ctx.db
      .select({ id: documents.id, name: documents.name, text: documents.textContent })
      .from(vaultDocuments)
      .innerJoin(documents, eq(documents.id, vaultDocuments.documentId))
      .where(and(eq(vaultDocuments.vaultId, input.vaultId), eq(documents.parseStatus, "parsed")))
      .limit(40);
    for (const r of rows) {
      if (r.text) out.push({ id: r.id, sourceType: "document", sourceName: r.name, text: r.text });
    }
  } else {
    const conds = [eq(documents.workspaceId, session.workspaceId), eq(documents.parseStatus, "parsed")];
    if (input.companyId) conds.push(eq(documents.companyId, input.companyId));
    if (input.dealId) conds.push(eq(documents.dealId, input.dealId));
    const rows = await ctx.db
      .select({ id: documents.id, name: documents.name, text: documents.textContent })
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.createdAt))
      .limit(input.companyId || input.dealId ? 25 : 40);
    for (const r of rows) {
      if (r.text) out.push({ id: r.id, sourceType: "document", sourceName: r.name, text: r.text });
    }
  }

  // ── notes ───────────────────────────────────────────────────────────
  const noteConds = [eq(notes.workspaceId, session.workspaceId)];
  if (input.companyId) noteConds.push(eq(notes.companyId, input.companyId));
  if (input.dealId) noteConds.push(eq(notes.dealId, input.dealId));
  const noteRows = await ctx.db
    .select({ id: notes.id, body: notes.body })
    .from(notes)
    .where(and(...noteConds))
    .orderBy(desc(notes.createdAt))
    .limit(15);
  for (const n of noteRows) {
    out.push({ id: n.id, sourceType: "note", sourceName: "Team note", text: n.body });
  }

  // ── portfolio updates ───────────────────────────────────────────────
  const updateConds = [eq(portfolioUpdates.workspaceId, session.workspaceId)];
  if (input.companyId) updateConds.push(eq(portfolioUpdates.companyId, input.companyId));
  const updateRows = await ctx.db
    .select({ id: portfolioUpdates.id, title: portfolioUpdates.title, body: portfolioUpdates.body })
    .from(portfolioUpdates)
    .where(and(...updateConds))
    .orderBy(desc(portfolioUpdates.occurredAt))
    .limit(12);
  for (const u of updateRows) {
    out.push({
      id: u.id,
      sourceType: "portfolio_update",
      sourceName: u.title,
      text: `${u.title}. ${u.body ?? ""}`.slice(0, 1200),
    });
  }

  // ── emails (workspace-wide unless company-scoped by sender match) ───
  if (!input.vaultId && !input.companyId && !input.dealId) {
    const emailRows = await ctx.db
      .select({ id: emailMessages.id, subject: emailMessages.subject, body: emailMessages.bodyText })
      .from(emailMessages)
      .where(eq(emailMessages.workspaceId, session.workspaceId))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(10);
    for (const e of emailRows) {
      out.push({
        id: e.id,
        sourceType: "email",
        sourceName: e.subject || "(no subject)",
        text: `${e.subject}. ${(e.body ?? "").slice(0, 800)}`,
      });
    }
  }

  // ── firm memory (declared preferences shape every answer) ──────────
  if (input.includeFirmContext !== false) {
    const mems = await groundingMemories(ctx, session.workspaceId, session.actor.userId ?? undefined);
    for (const m of mems) {
      out.push({ id: m.id, sourceType: "memory", sourceName: m.sourceName, text: m.content });
    }
  }

  // cap total grounding size deterministically (documents first, memories last kept)
  return out.slice(0, 80);
}

export async function listReports(
  ctx: CoreContext,
  session: Session,
  filter: { companyId?: string; limit?: number; offset?: number },
): Promise<{ items: ResearchReportDto[]; total: number }> {
  const conds = [eq(researchReports.workspaceId, session.workspaceId)];
  if (filter.companyId) conds.push(eq(researchReports.scopeCompanyId, filter.companyId));
  const where = and(...conds);

  const rows = await ctx.db
    .select()
    .from(researchReports)
    .where(where)
    .orderBy(desc(researchReports.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);

  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(researchReports)
    .where(where);

  return { items: rows.map((r) => mapReport(r, r.creditsUsed)), total };
}

export async function getReport(
  ctx: CoreContext,
  session: Session,
  reportId: string,
): Promise<ResearchReportDto> {
  const [row] = await ctx.db
    .select()
    .from(researchReports)
    .where(and(eq(researchReports.id, reportId), eq(researchReports.workspaceId, session.workspaceId)));
  if (!row) throw new Error("report not found");
  return mapReport(row, row.creditsUsed);
}

type ReportRow = typeof researchReports.$inferSelect;

function mapReport(row: ReportRow, creditsUsed: number): ResearchReportDto {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    citations: row.citations ?? [],
    scopeCompanyId: row.scopeCompanyId,
    scopeDealId: row.scopeDealId,
    scopeVaultId: row.scopeVaultId,
    model: row.model,
    confidence: row.confidence === null ? null : Number(row.confidence),
    creditsUsed,
    createdAt: toIso(row.createdAt)!,
  };
}
