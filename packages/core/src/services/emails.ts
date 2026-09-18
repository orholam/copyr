import { and, desc, eq, sql } from "drizzle-orm";
import {
  companies,
  emailMessages,
  memberships,
  pipelines,
  portfolioUpdates,
  relationships,
  stages,
  users,
} from "@copyr/db/schema.js";
import type { InboundEmailPayload, EmailDto } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { mapEmail } from "../mappers.js";
import { logActivity } from "../activity.js";
import { spendCredits } from "../credits.js";
import { findCompanyMatch, nextStagePosition } from "./companies.js";
import { resolvePipelineStage } from "./pipelines.js";
import { uploadDocument } from "./documents.js";

const EMAIL_ACTOR: Session = { workspaceId: "", actor: { userId: null, source: "email" } };

/** Store + enqueue an inbound email. Idempotent per (workspaceId, messageId). */
export async function ingestEmail(
  ctx: CoreContext,
  workspaceId: string,
  payload: InboundEmailPayload,
): Promise<EmailDto> {
  const existing = await ctx.db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.workspaceId, workspaceId),
        eq(emailMessages.messageId, payload.messageId),
      ),
    );
  if (existing.length) {
    const [row] = await ctx.db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, existing[0]!.id));
    return mapEmail(row!);
  }

  const attachments = [];
  for (const att of payload.attachments ?? []) {
    let storageKey = att.storageKey;
    if (!storageKey && att.contentBase64) {
      storageKey = `workspaces/${workspaceId}/inbound/${crypto.randomUUID()}/${att.filename}`;
      await ctx.storage.put(storageKey, Buffer.from(att.contentBase64, "base64"), att.mime);
    }
    if (!storageKey) continue;
    attachments.push({
      filename: att.filename,
      mime: att.mime,
      sizeBytes: att.sizeBytes ?? 0,
      storageKey,
    });
  }

  const [row] = await ctx.db
    .insert(emailMessages)
    .values({
      workspaceId,
      messageId: payload.messageId,
      direction: "inbound",
      channel: "webhook",
      fromEmail: payload.from.email,
      fromName: payload.from.name ?? null,
      toEmails: payload.to,
      subject: payload.subject,
      bodyText: payload.text ?? null,
      bodyHtml: payload.html ?? null,
      attachments,
      receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : new Date(),
      processingStatus: "queued",
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId,
    entityType: "email",
    entityId: row.id,
    type: "email.received",
    summary: `Inbound email "${row.subject || "(no subject)"}" from ${row.fromEmail}`,
    actor: "system",
  });

  await ctx.enqueue("process-email", { workspaceId, emailId: row.id });
  return mapEmail(row);
}

export async function listEmails(
  ctx: CoreContext,
  session: Session,
  query: { status?: string; limit?: number; offset?: number },
): Promise<{ items: EmailDto[]; total: number }> {
  const conds = [eq(emailMessages.workspaceId, session.workspaceId)];
  if (query.status) conds.push(eq(emailMessages.processingStatus, query.status as never));
  const where = and(...conds);
  const rows = await ctx.db
    .select()
    .from(emailMessages)
    .where(where)
    .orderBy(desc(emailMessages.receivedAt))
    .limit(query.limit ?? 50)
    .offset(query.offset ?? 0);
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(where);
  return { items: rows.map(mapEmail), total };
}

export async function getEmail(
  ctx: CoreContext,
  session: Session,
  emailId: string,
): Promise<EmailDto> {
  const [row] = await ctx.db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.id, emailId), eq(emailMessages.workspaceId, session.workspaceId)));
  if (!row) throw new CoreError("email not found", { status: 404 });
  return mapEmail(row);
}

/** Re-run processing for a stuck/failed message. */
export async function reprocessEmail(
  ctx: CoreContext,
  session: Session,
  emailId: string,
): Promise<void> {
  await ctx.db
    .update(emailMessages)
    .set({ processingStatus: "queued", error: null })
    .where(and(eq(emailMessages.id, emailId), eq(emailMessages.workspaceId, session.workspaceId)));
  await ctx.enqueue("process-email", { workspaceId: session.workspaceId, emailId });
}

export interface ProcessEmailResult {
  matchedCompanies: string[];
  createdCompanies: string[];
  createdDeals: string[];
  portfolioUpdates: string[];
  confidence: number;
  summary?: string;
}

/**
 * Full AI triage pipeline. Runs in the process-email job; exported so dev API
 * can run it synchronously and agents can trigger it explicitly.
 */
export async function processEmailMessage(
  ctx: CoreContext,
  workspaceId: string,
  emailId: string,
): Promise<ProcessEmailResult> {
  const [email] = await ctx.db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.id, emailId), eq(emailMessages.workspaceId, workspaceId)));
  if (!email) throw new CoreError("email not found", { status: 404 });

  await ctx.db
    .update(emailMessages)
    .set({ processingStatus: "processing" })
    .where(eq(emailMessages.id, emailId));

  try {
    const session: Session = { ...EMAIL_ACTOR, workspaceId };

    const result = await ctx.db.transaction(async (tx) => {
      const known = await tx
        .select({
          id: companies.id,
          name: companies.name,
          status: companies.status,
        })
        .from(companies)
        .where(eq(companies.workspaceId, workspaceId));

      const triage = await ctx.ai.triageEmail({
        subject: email.subject,
        fromEmail: email.fromEmail,
        bodyText: email.bodyText ?? "",
        knownCompanyNames: known.map((k) => k.name),
      });
      await spendCredits(ctx, tx as never, workspaceId, "email_triage", {
        refType: "email",
        refId: email.id,
      });

      const result: ProcessEmailResult = {
        matchedCompanies: [],
        createdCompanies: [],
        createdDeals: [],
        portfolioUpdates: [],
        confidence: triage.confidence,
        summary: triage.summary,
      };

      const pipelineRows = await tx
        .select()
        .from(pipelines)
        .where(eq(pipelines.workspaceId, workspaceId))
        .orderBy(pipelines.position)
        .limit(1);
      const intakeStage = pipelineRows[0]
        ? (
            await tx
              .select()
              .from(stages)
              .where(eq(stages.pipelineId, pipelineRows[0].id))
              .orderBy(stages.position)
              .limit(1)
          )[0]
        : undefined;

      // team member receiving this address (for relationship intel)
      const teamMembers = await tx
        .select({ userId: users.id, email: users.email })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(eq(memberships.workspaceId, workspaceId));
      const toSet = new Set(email.toEmails.map((t) => t.toLowerCase()));
      const teamMember =
        teamMembers.find((m) => m.email && toSet.has(m.email.toLowerCase())) ?? teamMembers[0];

      const createdOrMatchedDeals: Array<{ companyId: string; dealId: string | null }> = [];

      for (const detected of triage.companies.slice(0, 200)) {
        if (detected.name.length < 2) continue;

        const match = await findCompanyMatch(ctx, tx, workspaceId, detected.name, detected.domain ?? null);
        let companyId: string;

        if (match) {
          companyId = match.id;
          result.matchedCompanies.push(match.name);
        } else {
          const roundGuess = /\b(pre-seed|seed|series [a-e])\b/i.exec(
            `${email.subject}\n${email.bodyText}`,
          );
          const placement = intakeStage
            ? { pipelineId: intakeStage.pipelineId, stage: intakeStage }
            : await resolvePipelineStage(ctx, tx, workspaceId);
          const position = await nextStagePosition(tx, placement.stage.id);
          const [company] = await tx
            .insert(companies)
            .values({
              workspaceId,
              name: detected.name,
              domain: detected.domain ?? null,
              source: "email",
              pipelineId: placement.pipelineId,
              stageId: placement.stage.id,
              roundStage: roundGuess ? titleCase(roundGuess[1]!) : null,
              sourceRef: email.messageId,
              createdByUserId: teamMember?.userId ?? null,
              position,
            })
            .returning();
          companyId = company!.id;
          result.createdCompanies.push(company!.name);
          result.createdDeals.push(company!.id);

          await logActivity(ctx, tx, {
            workspaceId,
            entityType: "deal",
            entityId: company!.id,
            companyId,
            dealId: company!.id,
            type: "deal.created",
            summary: `Deal created from inbound email`,
            actor: "system",
            data: { emailId, from: email.fromEmail },
          });
        }

        const firstDealForCompany = companyId;
        createdOrMatchedDeals.push({ companyId, dealId: firstDealForCompany });

        // contact upsert
        const contactExists = await tx.execute(
          sql`select 1 from contacts where email = ${email.fromEmail} and company_id = ${companyId} limit 1`,
        );
        if (contactExists.rows.length === 0) {
          await tx.execute(sql`
            insert into contacts (workspace_id, company_id, name, email, is_founder)
            values (${workspaceId}, ${companyId}, ${email.fromName ?? email.fromEmail.split("@")[0]}, ${email.fromEmail}, ${triage.intent === "fundraise"})
          `);
        }

        // relationship graph upsert
        await tx
          .insert(relationships)
          .values({
            workspaceId,
            companyId,
            contactEmail: email.fromEmail,
            teamMemberUserId: teamMember?.userId ?? null,
            teamMemberEmail: teamMember?.email ?? null,
            interactionCount: 1,
            lastInteractionAt: email.receivedAt,
          })
          .onConflictDoUpdate({
            target: [
              relationships.companyId,
              relationships.contactEmail,
              relationships.teamMemberEmail,
            ],
            set: {
              interactionCount: sql`${relationships.interactionCount} + 1`,
              lastInteractionAt: email.receivedAt,
            },
          });

        await logActivity(ctx, tx, {
          workspaceId,
          entityType: "email",
          entityId: email.id,
          companyId,
          dealId: firstDealForCompany,
          type: "email.linked",
          summary: `Communication logged (${triage.intent.replace("_", " ")})`,
          actor: "system",
          data: { intent: triage.intent },
        });

        // portfolio company + update-shaped email → timeline entry
        const isPortco =
          known.find((k) => k.id === companyId)?.status === "portfolio" ||
          (
            await tx
              .select({ id: companies.id })
              .from(companies)
              .innerJoin(stages, eq(companies.stageId, stages.id))
              .where(and(eq(companies.id, companyId), eq(stages.kind, "won")))
              .limit(1)
          ).length > 0;

        if (isPortco && triage.isPortfolioUpdate && email.bodyText) {
          const classification = await ctx.ai.classifyUpdate(`${email.subject}\n${email.bodyText}`);
          await spendCredits(ctx, tx as never, workspaceId, "update_classification", {
            refType: "email",
            refId: email.id,
          });
          await tx.insert(portfolioUpdates).values({
            workspaceId,
            companyId,
            title: classification.title,
            body: email.bodyText.slice(0, 8000),
            kind: classification.kind,
            occurredAt: email.receivedAt,
            source: "email",
            sourceEmailId: email.id,
          });
          result.portfolioUpdates.push(companyId);

          await logActivity(ctx, tx, {
            workspaceId,
            entityType: "portfolio_update",
            entityId: email.id,
            companyId,
            dealId: firstDealForCompany,
            type: "portfolio_update.created",
            summary: `Portfolio ${classification.kind}: ${classification.title}`,
            actor: "ai",
          });
        }
      }

      await tx
        .update(emailMessages)
        .set({
          processingStatus: "processed",
          processedResult: result as unknown as Record<string, unknown>,
        })
        .where(eq(emailMessages.id, emailId));

      await logActivity(ctx, tx, {
        workspaceId,
        entityType: "email",
        entityId: email.id,
        type: "email.processed",
        summary: `AI processed: ${result.createdCompanies.length} new, ${result.matchedCompanies.length} matched`,
        actor: "ai",
        data: result as unknown as Record<string, unknown>,
      });

      return { result, createdOrMatchedDeals };
    });

    // Attach PDF attachments AFTER commit (uploadDocument uses its own
    // connection; the deal/company rows must be visible to it).
    for (let i = 0; i < email.attachments.length; i++) {
      const att = email.attachments[i]!;
      if (!att.mime.includes("pdf") && !att.filename.toLowerCase().endsWith(".pdf")) continue;
      const bytes = await ctx.storage.get(att.storageKey!);
      const doc = await uploadDocument(ctx, session, {
        name: att.filename,
        mime: att.mime || "application/pdf",
        content: bytes,
        source: "email_attachment",
        companyId: result.createdOrMatchedDeals[i]?.companyId,
        dealId: result.createdOrMatchedDeals[i]?.dealId ?? undefined,
      });
      await ctx.enqueue("parse-document", { workspaceId, documentId: doc.id });
    }

    return result.result;
  } catch (err) {
    await ctx.db
      .update(emailMessages)
      .set({
        processingStatus:
          err instanceof CoreError && err.code === "credits_exhausted" ? "needs_review" : "failed",
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(emailMessages.id, emailId));
    throw err;
  }
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
