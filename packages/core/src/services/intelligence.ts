import { and, eq, sql } from "drizzle-orm";
import { companies, deals, documents } from "@copyr/db/schema.js";
import type { DealDto } from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { spendCredits } from "../credits.js";
import { getCompanyRow, findCompanyMatch } from "./companies.js";
import { getDefaultPipeline } from "./pipelines.js";
import { stages as stagesT } from "@copyr/db/schema.js";
import { generateKeyBetween } from "../fractional.js";

/* ── AI investment thesis generation (ToS 2.1 parity) ─────────────── */

export interface ThesisMemo {
  companyId: string;
  companyName: string;
  memo: string;
  confidence: number;
}

export async function generateThesis(
  ctx: CoreContext,
  session: Session,
  companyId: string,
): Promise<ThesisMemo> {
  const company = await getCompanyRow(ctx, ctx.db, session.workspaceId, companyId);
  const [deal] = await ctx.db
    .select()
    .from(deals)
    .where(and(eq(deals.companyId, companyId), eq(deals.workspaceId, session.workspaceId)))
    .limit(1);
  const docs = await ctx.db
    .select({ textContent: documents.textContent })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.parseStatus, "parsed")))
    .limit(3);

  const sourceText = [
    company.description ?? "",
    ...docs.map((d) => d.textContent ?? ""),
    deal?.roundStage ? `Round: ${deal.roundStage}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000);

  const memo = await ctx.db.transaction(async (tx) => {
    await spendCredits(ctx, tx as never, session.workspaceId, "assistant_turn", {
      refType: "company",
      refId: companyId,
    });
    const result = await ctx.ai.generateThesis({
      companyName: company.name,
      sector: company.sector,
      description: company.description,
      location: company.location,
      roundStage: deal?.roundStage ?? null,
      askAmount: deal?.askAmount ? Number(deal.askAmount) : null,
      sourceText,
    });
    return result;
  });

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "company",
    entityId: companyId,
    companyId,
    dealId: deal?.id ?? null,
    type: "thesis.generated",
    summary: `AI generated an investment memo for ${company.name}`,
    actor: "ai",
    actorUserId: session.actor.userId,
    data: { model: ctx.ai.model },
  });

  return {
    companyId,
    companyName: company.name,
    memo: memo.memo,
    confidence: memo.confidence,
  };
}

/* ── Browser-extension / external capture (ToS 4.3 parity) ────────── */

export interface CaptureInput {
  url: string;
  title?: string;
  note?: string;
  screenshotBase64?: string;
  createDeal?: boolean;
}

export interface CaptureResult {
  companyId: string;
  companyName: string;
  dealId: string | null;
  documentId: string | null;
}

/**
 * Capture any webpage into the CRM — the endpoint a Chrome extension calls.
 * Creates/links the company from the domain, optionally opens a deal, and
 * preserves either the screenshot or a link-converted PDF permanently.
 */
export async function capturePage(
  ctx: CoreContext,
  session: Session,
  input: CaptureInput,
): Promise<CaptureResult> {
  const url = new URL(input.url);
  if (!/^https?:$/.test(url.protocol)) throw new CoreError("only http(s) URLs can be captured", { status: 422 });
  const host = url.hostname.replace(/^www\./, "");
  const guessName = input.title?.split(/[|—–\-:]/)[0]?.trim() ||
    host.split(".")[0]!.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return ctx.db.transaction(async (tx) => {
    let company = await findCompanyMatch(ctx, tx, session.workspaceId, guessName, host);
    let created = false;
    if (!company) {
      const [row] = await tx
        .insert(companies)
        .values({
          workspaceId: session.workspaceId,
          name: guessName,
          domain: host,
          description: input.title ? `${input.title} — captured from ${host}` : `Captured from ${host}`,
          source: "api",
        })
        .returning();
      company = row!;
      created = true;
    }

    let dealId: string | null = null;
    if (input.createDeal !== false) {
      const [existing] = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.companyId, company.id), eq(deals.workspaceId, session.workspaceId)))
        .limit(1);
      if (existing) {
        dealId = existing.id;
      } else {
        const pipeline = await getDefaultPipeline(ctx, tx, session.workspaceId);
        const [intake] = await tx
          .select()
          .from(stagesT)
          .where(eq(stagesT.pipelineId, pipeline.id))
          .orderBy(stagesT.position)
          .limit(1);
        const [{ maxPos }] = await tx
          .select({ maxPos: sql<string | null>`max(${deals.position})` })
          .from(deals)
          .where(eq(deals.stageId, intake!.id));
        const [deal] = await tx
          .insert(deals)
          .values({
            workspaceId: session.workspaceId,
            companyId: company.id,
            pipelineId: pipeline.id,
            stageId: intake!.id,
            title: company.name,
            source: "api",
            sourceRef: input.url,
            createdByUserId: session.actor.userId,
            position: generateKeyBetween(maxPos, null),
          })
          .returning();
        dealId = deal.id;
      }
    }

    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "company",
      entityId: company.id,
      companyId: company.id,
      dealId,
      type: "company.updated",
      summary: created
        ? `Captured ${host} via browser extension`
        : `Captured page from ${host} and linked to existing record`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: { url: input.url, title: input.title ?? null },
    });

    // screenshot → stored document; otherwise queue link conversion for a permanent PDF
    const result: CaptureResult = {
      companyId: company.id,
      companyName: company.name,
      dealId,
      documentId: null,
    };
    return result;
  }).then(async (result) => {
    // post-commit side effects (own connections)
    if (input.screenshotBase64) {
      const doc = await import("./documents.js").then((m) =>
        m.uploadDocument(ctx, session, {
          name: `${result.companyName} — screenshot.png`,
          mime: "image/png",
          content: Buffer.from(input.screenshotBase64!, "base64"),
          companyId: result.companyId,
          dealId: result.dealId ?? undefined,
          source: "upload",
        }),
      );
      result.documentId = doc.id;
    } else {
      const link = await import("./documents.js").then((m) =>
        m.createDocumentFromLink(ctx, session, {
          url: input.url,
          companyId: result.companyId,
          dealId: result.dealId ?? undefined,
          companyName: undefined,
        }),
      );
      result.documentId = link.id;
    }
    if (input.note && result.dealId) {
      await import("./content.js").then((m) =>
        m.addNote(ctx, session, { companyId: result.companyId, dealId: result.dealId!, body: input.note! }),
      );
    }
    return result;
  });
}

/* ── Data export (privacy 6.3 parity) ─────────────────────────────── */

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportDeals(
  ctx: CoreContext,
  session: Session,
  format: "csv" | "json",
): Promise<{ body: string; contentType: string; filename: string }> {
  const { items } = await import("./deals.js").then((m) => m.listDeals(ctx, session, {
    limit: 500,
    offset: 0,
    archived: "all",
    sort: "created_at",
    order: "desc",
  } satisfies import("@copyr/contracts").ListDealsQuery));

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return {
      body: JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, deals: items }, null, 2),
      contentType: "application/json",
      filename: `copyr-deals-${stamp}.json`,
    };
  }
  const fieldKeys = [...new Set(items.flatMap((d: DealDto) => Object.keys(d.fields)))];
  const header = [
    "deal_id", "company", "domain", "title", "round", "ask_usd", "stage", "source", "tags",
    ...fieldKeys.map((k) => `field:${k}`),
    "created_at",
  ];
  const stageRows = await ctx.db.execute(sql`select id, name from stages where workspace_id = ${session.workspaceId}`);
  const stageNames = new Map(
    (stageRows.rows as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
  );
  const lines = [header.join(",")];
  for (const d of items) {
    lines.push([
      d.id, d.company.name, d.company.domain ?? "", d.title, d.roundStage ?? "", d.askAmount ?? "", stageNames.get(d.stageId) ?? "", d.source, (d.tags ?? []).join(";"),
      ...fieldKeys.map((k) => (d.fields[k] === undefined ? "" : Array.isArray(d.fields[k]) ? (d.fields[k] as string[]).join(";") : String(d.fields[k] ?? ""))),
      d.createdAt,
    ].map(csvEscape).join(","));
  }
  return {
    body: lines.join("\n"),
    contentType: "text/csv",
    filename: `copyr-deals-${stamp}.csv`,
  };
}
