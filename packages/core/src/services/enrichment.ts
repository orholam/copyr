import { eq, and } from "drizzle-orm";
import { companies, customFields, fieldValues } from "@copyr/db/schema.js";
import type { CoreContext, Session } from "../context.js";
import { logActivity } from "../activity.js";

const ENRICH_TIMEOUT_MS = 8_000;
const USER_AGENT = "VentureLabsBot/0.1 (+https://venturelabs.vercel.app)";

/** Best-effort website enrichment: fetch HTML, extract title/description, fill gaps on company. */
export async function enrichCompanyFromDomain(
  ctx: CoreContext,
  workspaceId: string,
  companyId: string,
): Promise<{ enriched: boolean; detail?: string }> {
  const [company] = await ctx.db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)));
  if (!company) return { enriched: false, detail: "company not found" };
  if (!company.domain) return { enriched: false, detail: "no domain" };

  const candidates = [`https://${company.domain}`, `http://${company.domain}`];
  let html = "";
  let title = "";
  let desc = "";
  let lastStatus: string | null = null;
  let fetched = false;
  let fetchedUrl: string | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
        signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
        redirect: "follow",
      });
      lastStatus = String(res.status);
      // try to read body even on non-2xx (some sites 403 but still send html)
      html = await res.text().catch(() => "");
      if (html) {
        fetched = true;
        fetchedUrl = url;
        break;
      }
      if (!res.ok) continue;
    } catch (e) {
      lastStatus = e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80);
    }
  }
  if (!fetched || !html) return { enriched: false, detail: `fetch ${lastStatus ?? "failed"} — no html` };
  title = html.match(/<title[^>]*>([^<]{1,160})<\/title>/i)?.[1]?.trim() ?? "";
  desc =
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]{1,400})"/i)?.[1] ??
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]{1,400})"/i)?.[1] ??
    "";
  if (!desc) {
    const p = html.match(/<p[^>]*>([^<]{30,300})<\/p>/i)?.[1]?.replace(/\s+/g, " ").trim();
    if (p) desc = p.slice(0, 400);
  }

  const textBlob = [title, desc, `Source: ${fetchedUrl ?? `https://${company.domain}`}`, `Domain: ${company.domain}`].filter(Boolean).join("\n\n");
  if (!textBlob.trim()) return { enriched: false, detail: "no content" };

  let inferredSector: string | null = null;
  let inferredFields: Record<string, unknown> = {};
  try {
    const specs = await ctx.db
      .select()
      .from(customFields)
      .where(and(eq(customFields.workspaceId, workspaceId), eq(customFields.aiExtractable, true)));
    const fieldSpecs = specs
      .filter((s) => s.target === "company")
      .map((s) => ({ key: s.key, label: s.label, type: s.type, options: s.options }));
    if (fieldSpecs.length) {
      const out = await ctx.ai.extractDeck(textBlob, fieldSpecs as never);
      inferredSector = out.company.sector ?? null;
      inferredFields = out.fields ?? {};
    }
  } catch {
    // best-effort
  }

  const patch: Record<string, unknown> = {};
  if (!company.description && desc) patch.description = desc.slice(0, 1000);
  if (!company.sector && inferredSector) patch.sector = inferredSector;
  if (!company.location && /based in|headquartered in/i.test(html)) {
    const loc = html.match(/(?:based|headquartered) in ([A-Z][\w .'-]+(?:, ?[A-Z]{2})?)/i)?.[1];
    if (loc) patch.location = loc.trim().slice(0, 120);
  }
  if (!company.description && !patch.description && title) {
    patch.description = title.slice(0, 400);
  }

  let updated = false;
  if (Object.keys(patch).length) {
    await ctx.db.update(companies).set({ ...patch, updatedAt: new Date() }).where(eq(companies.id, companyId));
    updated = true;
  }

  if (Object.keys(inferredFields).length) {
    const { setFieldValues } = await import("./fields.js");
    const session: Session = { workspaceId, actor: { userId: null, source: "agent" } };
    // Only set missing field values — avoid clobbering human input
    const existing = await ctx.db
      .select({ fieldId: fieldValues.fieldId })
      .from(fieldValues)
      .where(and(eq(fieldValues.workspaceId, workspaceId), eq(fieldValues.entityType, "company"), eq(fieldValues.entityId, companyId)));
    const existingIds = new Set(existing.map((r) => r.fieldId));
    // map key -> fieldId for inferred
    const specs = await ctx.db.select().from(customFields).where(eq(customFields.workspaceId, workspaceId));
    const keyToId = new Map(specs.map((s) => [s.key, s.id]));
    const toSet: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inferredFields)) {
      if (v === null || v === undefined || String(v).trim() === "") continue;
      const fid = keyToId.get(k);
      if (!fid || existingIds.has(fid)) continue;
      toSet[k] = v;
    }
    if (Object.keys(toSet).length) {
      try {
        await setFieldValues(ctx, ctx.db as never, session, "company", companyId, toSet as never, { confidence: 0.65 });
        updated = true;
      } catch {
        // non-fatal
      }
    }
  }

  if (!updated) return { enriched: false, detail: "nothing to fill" };

  await logActivity(ctx, ctx.db, {
    workspaceId,
    entityType: "company",
    entityId: companyId,
    companyId,
    dealId: companyId,
    type: "company.updated",
    summary: `Enriched ${company.name} from ${company.domain}`,
    actor: "ai",
    data: { domain: company.domain, patchKeys: Object.keys(patch), inferredFields: Object.keys(inferredFields) },
  });

  return { enriched: true, detail: `patched ${Object.keys(patch).join(",")}` };
}
