import { eq, and } from "drizzle-orm";
import { companies, customFields, fieldValues } from "@copyr/db/schema.js";
import type { CoreContext, Session } from "../context.js";
import { logActivity } from "../activity.js";
import { isPlaceholderCopy } from "../screenMaterial.js";
import { researchCompany } from "./parallel.js";

/** Research the company with Parallel and fill empty profile fields. */
export async function enrichCompanyFromDomain(
  ctx: CoreContext,
  workspaceId: string,
  companyId: string,
  opts: { announce?: boolean } = {},
): Promise<{ enriched: boolean; detail?: string; domain?: string | null }> {
  const [company] = await ctx.db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)));
  if (!company) return { enriched: false, detail: "company not found" };
  if (!company.domain) return { enriched: false, detail: "no domain", domain: null };

  const researched = await researchCompany({ name: company.name, domain: company.domain });
  if ("error" in researched) return { enriched: false, detail: researched.error, domain: company.domain };
  const profile = researched.profile;

  const desc = profile.description;
  const textBlob = [
    desc,
    profile.sector && `Sector: ${profile.sector}`,
    profile.location && `Location: ${profile.location}`,
    `Domain: ${company.domain}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!textBlob.trim()) return { enriched: false, detail: "no content", domain: company.domain };

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
  const descriptionMissing = !company.description || isPlaceholderCopy(company.description);
  if (descriptionMissing && desc) patch.description = desc.slice(0, 1000);
  const sector = profile.sector || inferredSector;
  if (!company.sector && sector) patch.sector = sector;
  if (!company.location && profile.location) patch.location = profile.location;
  if (company.foundedYear == null && profile.foundedYear != null) patch.foundedYear = profile.foundedYear;
  if (company.employeeCount == null && profile.employeeCount != null) patch.employeeCount = profile.employeeCount;

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

  if (!updated) return { enriched: false, detail: "nothing to fill", domain: company.domain };

  if (opts.announce !== false) await logActivity(ctx, ctx.db, {
    workspaceId,
    entityType: "company",
    entityId: companyId,
    companyId,
    dealId: companyId,
    type: "company.updated",
    summary: `Researched ${company.name} with Parallel`,
    actor: "ai",
    data: { domain: company.domain, patchKeys: Object.keys(patch), inferredFields: Object.keys(inferredFields) },
  });

  return { enriched: true, detail: `patched ${Object.keys(patch).join(",") || "fields"}`, domain: company.domain };
}
