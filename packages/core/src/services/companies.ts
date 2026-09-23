import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { companies, contacts } from "@copyr/db/schema.js";
import type {
  CompanyDto,
  CreateCompanyValues,
  UpdateCompanyInput,
  FieldValuePrimitive,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { mapCompany } from "../mappers.js";
import { logActivity } from "../activity.js";
import { generateKeyBetween } from "../fractional.js";
import { loadFieldMaps, setFieldValues } from "./fields.js";
import { resolvePipelineStage } from "./pipelines.js";

async function tryFastWebsiteEnrich(domain?: string | null): Promise<{ description?: string; sector?: string }> {
  if (!domain) return {};
  const url = `https://${domain}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "VentureLabsBot/0.1 (+https://venturelabs.vercel.app)" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return {};
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim() ?? "";
    const desc =
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]{1,400})"/i)?.[1] ??
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]{1,400})"/i)?.[1] ??
      "";
    const out: Record<string, string> = {};
    if (desc) out.description = desc.slice(0, 800);
    else if (title) out.description = title.slice(0, 400);
    // sector keyword heuristic (lightweight, no AI call before insert)
    const lower = (desc + " " + title).toLowerCase();
    if (/(inference|efficiency|developer|devtools|api|pipeline)/.test(lower)) out.sector = "Dev Tools";
    else if (/(ai|machine learning|llm|model)/.test(lower)) out.sector = "AI/ML";
    return out;
  } catch {
    return {};
  }
}

type Exec = Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0];

export async function nextStagePosition(
  exec: CoreContext["db"] | Exec,
  stageId: string,
): Promise<string> {
  const [{ maxPos }] = await exec
    .select({ maxPos: sql<string | null>`max(${companies.position})` })
    .from(companies)
    .where(and(eq(companies.stageId, stageId), isNull(companies.archivedAt)));
  return generateKeyBetween(maxPos, null);
}

export async function getCompanyRow(
  ctx: CoreContext,
  exec: CoreContext["db"] | Exec,
  workspaceId: string,
  companyId: string,
) {
  const [row] = await exec
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)));
  if (!row) throw new CoreError("company not found", { status: 404 });
  return row;
}

/** Find a company by exact domain or case-insensitive name (dedupe helper). */
export async function findCompanyMatch(
  ctx: CoreContext,
  exec: CoreContext["db"] | Exec,
  workspaceId: string,
  name: string,
  domain?: string | null,
): Promise<typeof companies.$inferSelect | undefined> {
  const conditions = [];
  if (domain) {
    const clean = domain.replace(/^www\./, "").toLowerCase();
    conditions.push(sql`lower(${companies.domain}) = ${clean}`);
    conditions.push(sql`lower(${companies.name}) = ${clean.split(".")[0]!.replace(/[-_]/g, " ")}`);
  }
  conditions.push(sql`lower(${companies.name}) = lower(${name})`);
  const [row] = await exec
    .select()
    .from(companies)
    .where(
      and(eq(companies.workspaceId, workspaceId), conditions.length === 1 ? conditions[0]! : or(...conditions)),
    )
    .limit(1);
  return row;
}

export async function listCompanies(
  ctx: CoreContext,
  session: Session,
  query: {
    q?: string;
    status?: "active" | "portfolio" | "passed" | "archived";
    sector?: string[];
    tag?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: CompanyDto[]; total: number }> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const conds = [eq(companies.workspaceId, session.workspaceId)];
  if (query.status) conds.push(eq(companies.status, query.status));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(
      or(ilike(companies.name, like), ilike(companies.domain, like), ilike(companies.description, like))!,
    );
  }
  const where = and(...conds);

  const rows = await ctx.db
    .select()
    .from(companies)
    .where(where)
    .orderBy(desc(companies.updatedAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(companies)
    .where(where);

  let filtered = rows;
  const fieldMaps = await loadFieldMaps(
    ctx,
    session.workspaceId,
    "company",
    rows.map((r) => r.id),
  );
  if (query.sector?.length) {
    filtered = rows.filter((r) => {
      const sector = (fieldMaps.get(r.id)?.["sector"] as string) ?? r.sector ?? "";
      return query.sector!.some((s) => s.toLowerCase() === String(sector).toLowerCase());
    });
  }
  return {
    items: filtered.map((r) => mapCompany(r, fieldMaps.get(r.id) ?? {})),
    total,
  };
}

export async function getCompany(
  ctx: CoreContext,
  session: Session,
  companyId: string,
): Promise<CompanyDto> {
  const row = await getCompanyRow(ctx, ctx.db, session.workspaceId, companyId);
  const fields = await loadFieldMaps(ctx, session.workspaceId, "company", [companyId]);
  return mapCompany(row, fields.get(companyId) ?? {});
}

export async function createCompany(
  ctx: CoreContext,
  session: Session,
  input: CreateCompanyValues,
): Promise<CompanyDto> {
  // Opportunistic fast enrichment before insert so Thesis Screener sees more than a bare name
  let fastEnrich: { description?: string; sector?: string } = {};
  if (input.domain && !input.description) {
    fastEnrich = await tryFastWebsiteEnrich(input.domain);
  }

  return ctx.db.transaction(async (tx) => {
    // dedupe by name/domain — unless explicitly updating an existing record
    const existing = await findCompanyMatch(ctx, tx, session.workspaceId, input.name, input.domain);
    if (existing && !input.mergeWithExisting) {
      throw new CoreError(`company "${existing.name}" already exists`, {
        code: "company_exists",
        status: 409,
        details: { companyId: existing.id, companyName: existing.name },
      });
    }
    if (existing && input.mergeWithExisting) {
      // caller acknowledged the dupe — reuse the existing record as-is
      return existing.id;
    }

    const { pipelineId, stage } = await resolvePipelineStage(ctx, tx, session.workspaceId, {
      pipelineId: input.pipelineId,
      stageId: input.stageId,
    });
    const position = await nextStagePosition(tx, stage.id);

    const [row] = await tx
      .insert(companies)
      .values({
        workspaceId: session.workspaceId,
        name: input.name,
        domain: input.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
        sector: input.sector ?? fastEnrich.sector ?? null,
        location: input.location ?? null,
        description: input.description ?? fastEnrich.description ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        logoUrl: input.logoUrl ?? null,
        foundedYear: input.foundedYear ?? null,
        employeeCount: input.employeeCount ?? null,
        status: input.status ?? "active",
        source: session.actor.source === "api" ? "api" : "manual",
        createdByUserId: session.actor.userId,
        pipelineId,
        stageId: stage.id,
        ownerUserId: input.ownerUserId ?? null,
        roundStage: input.roundStage ?? null,
        askAmount: input.askAmount != null ? String(input.askAmount) : null,
        valuation: input.valuation != null ? String(input.valuation) : null,
        priority: input.priority ?? 0,
        position,
        nextStepAt: input.nextStepAt ? new Date(input.nextStepAt) : null,
        sourceRef: input.sourceRef ?? null,
        tags: input.tags ?? [],
      })
      .returning();

    if (input.fields) {
      await setFieldValues(
        ctx,
        tx as unknown as Exec,
        session,
        "company",
        row.id,
        input.fields as Record<string, FieldValuePrimitive>,
      );
    }

    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "company",
      entityId: row.id,
      companyId: row.id,
      dealId: row.id,
      type: "company.created",
      summary: `Company "${row.name}" created`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
    });

    return row.id;
  }).then(async (id) => {
    const companyId = String(id);
    const domain = input.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    if (domain) {
      // Visible enrichment: queue the Website Enricher agent (customers see it in Agents)
      // and also keep the raw job as a fallback if the agent isn't seeded yet.
      void (async () => {
        try {
          const { agents } = await import("@copyr/db/schema.js");
          const [agent] = await ctx.db
            .select()
            .from(agents)
            .where(and(eq(agents.workspaceId, session.workspaceId), eq(agents.name, "Website Enricher")));
          if (agent) {
            const { queueAgentRun } = await import("./agents.js");
            await queueAgentRun(
              ctx,
              { workspaceId: session.workspaceId, actor: { userId: null, source: "agent" } },
              agent.id,
              { companyId, dealId: companyId, trigger: "workflow" },
            );
            return;
          }
        } catch {}
        // fallback: raw enrichment job / inline
        void ctx.enqueue("enrich-company", { workspaceId: session.workspaceId, companyId }).catch(() => undefined);
        if (!ctx.boss) {
          void import("./enrichment.js")
            .then((m) => m.enrichCompanyFromDomain(ctx, session.workspaceId, companyId))
            .catch(() => undefined);
        }
      })().catch(() => undefined);
    }
    return getCompany(ctx, session, companyId);
  });
}

export async function updateCompany(
  ctx: CoreContext,
  session: Session,
  companyId: string,
  patch: UpdateCompanyInput,
): Promise<CompanyDto> {
  return ctx.db.transaction(async (tx) => {
    await getCompanyRow(ctx, tx, session.workspaceId, companyId);
    const {
      fields,
      mergeWithExisting: _ignored,
      askAmount,
      valuation,
      nextStepAt,
      ...rest
    } = patch;
    void _ignored;
    const [row] = await tx
      .update(companies)
      .set({
        ...rest,
        domain:
          rest.domain !== undefined
            ? rest.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
            : undefined,
        ...(askAmount !== undefined ? { askAmount: askAmount === null ? null : String(askAmount) } : {}),
        ...(valuation !== undefined ? { valuation: valuation === null ? null : String(valuation) } : {}),
        ...(nextStepAt !== undefined
          ? { nextStepAt: nextStepAt === null ? null : new Date(nextStepAt) }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(companies.id, companyId), eq(companies.workspaceId, session.workspaceId)))
      .returning();

    if (fields) {
      await setFieldValues(
        ctx,
        tx as unknown as Exec,
        session,
        "company",
        companyId,
        fields as Record<string, FieldValuePrimitive>,
      );
    }

    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "company",
      entityId: companyId,
      companyId,
      type: "company.updated",
      summary: `Company "${row.name}" updated`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: rest as Record<string, unknown>,
    });

    return companyId;
  }).then(async (id) => {
    const companyId = String(id);
    const domain = (patch as Record<string, unknown>).domain as string | undefined;
    const cleaned = domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    if (cleaned) {
      void (async () => {
        try {
          const { agents } = await import("@copyr/db/schema.js");
          const [agent] = await ctx.db
            .select()
            .from(agents)
            .where(and(eq(agents.workspaceId, session.workspaceId), eq(agents.name, "Website Enricher")));
          if (agent) {
            const { queueAgentRun } = await import("./agents.js");
            await queueAgentRun(
              ctx,
              { workspaceId: session.workspaceId, actor: { userId: null, source: "agent" } },
              agent.id,
              { companyId, dealId: companyId, trigger: "workflow" },
            );
            return;
          }
        } catch {}
        void ctx.enqueue("enrich-company", { workspaceId: session.workspaceId, companyId }).catch(() => undefined);
        if (!ctx.boss) {
          void import("./enrichment.js")
            .then((m) => m.enrichCompanyFromDomain(ctx, session.workspaceId, companyId))
            .catch(() => undefined);
        }
      })().catch(() => undefined);
    }
    return getCompany(ctx, session, companyId);
  });
}

export async function upsertContact(
  ctx: CoreContext,
  exec: Exec,
  session: Session,
  input: {
    companyId?: string | null;
    name: string;
    email?: string | null;
    title?: string | null;
    isFounder?: boolean;
  },
) {
  if (input.email) {
    const [existing] = await exec
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, session.workspaceId), eq(contacts.email, input.email)));
    if (existing) return existing;
  }
  const [row] = await exec
    .insert(contacts)
    .values({
      workspaceId: session.workspaceId,
      companyId: input.companyId ?? null,
      name: input.name,
      email: input.email ?? null,
      title: input.title ?? null,
      isFounder: input.isFounder ?? false,
    })
    .returning();
  return row;
}

export async function listContacts(ctx: CoreContext, session: Session, companyId: string) {
  return ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, session.workspaceId), eq(contacts.companyId, companyId)))
    .orderBy(asc(contacts.createdAt));
}

export async function deleteCompany(
  ctx: CoreContext,
  session: Session,
  companyId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(companies)
    .where(and(eq(companies.id, companyId), eq(companies.workspaceId, session.workspaceId)))
    .returning({ id: companies.id });
  if (!deleted.length) throw new CoreError("company not found", { status: 404 });
}

export async function companiesByIds(
  ctx: CoreContext,
  ids: string[],
): Promise<Map<string, typeof companies.$inferSelect>> {
  if (!ids.length) return new Map();
  const rows = await ctx.db.select().from(companies).where(inArray(companies.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/* ── merge duplicates ─────────────────────────────────────────────── */

/**
 * Merge `fromCompany` into `into`: repoints deals, documents, notes,
 * contacts, portfolio updates, relationships and custom-field values,
 * archives the source record, and logs the merge on both timelines.
 * Target wins on conflicting custom fields.
 */
export async function mergeCompany(
  ctx: CoreContext,
  session: Session,
  fromCompanyId: string,
  intoCompanyId: string,
): Promise<CompanyDto> {
  if (fromCompanyId === intoCompanyId) {
    throw new CoreError("cannot merge a company into itself", { code: "self_merge", status: 422 });
  }
  return ctx.db.transaction(async (tx) => {
    const from = await getCompanyRow(ctx, tx, session.workspaceId, fromCompanyId);
    const into = await getCompanyRow(ctx, tx, session.workspaceId, intoCompanyId);

    for (const table of ["documents", "notes", "contacts", "portfolio_updates"] as const) {
      await tx.execute(sql.raw(
        `update ${table} set company_id = '${into.id}' where company_id = '${from.id}'`,
      ));
    }
    for (const table of ["documents", "notes", "activities", "extractions", "vaults", "agent_runs", "spaces", "tasks"] as const) {
      await tx.execute(sql.raw(
        `update ${table} set deal_id = '${into.id}' where deal_id = '${from.id}'`,
      ));
    }
    await tx.execute(sql`update research_reports set scope_company_id = ${into.id} where scope_company_id = ${from.id}`);
    await tx.execute(sql`update research_reports set scope_deal_id = ${into.id} where scope_deal_id = ${from.id}`);
    await tx.execute(sql`update relationships set company_id = ${into.id} where company_id = ${from.id}`);
    // field values: copy missing, keep target's existing
    await tx.execute(sql`
      insert into field_values (workspace_id, field_id, entity_type, entity_id, value, confidence, set_by_actor, updated_at)
      select fv.workspace_id, fv.field_id, fv.entity_type, ${into.id}, fv.value, fv.confidence, fv.set_by_actor, now()
      from field_values fv
      where fv.entity_type = 'company' and fv.entity_id = ${from.id}
      on conflict (field_id, entity_type, entity_id) do nothing
    `);
    await tx.execute(sql`delete from field_values where entity_type = 'company' and entity_id = ${from.id}`);

    await tx
      .update(companies)
      .set({ status: "archived", mergedIntoCompanyId: into.id, archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(companies.id, from.id));

    // fill gaps on the survivor from the merged record
    const patch: Record<string, unknown> = {};
    for (const k of ["sector", "location", "description", "linkedinUrl", "logoUrl", "domain"] as const) {
      if (!into[k] && from[k]) patch[k] = from[k];
    }
    if (into.foundedYear === null && from.foundedYear) patch.foundedYear = from.foundedYear;
    if (into.employeeCount === null && from.employeeCount) patch.employeeCount = from.employeeCount;
    if (Object.keys(patch).length) {
      await tx.update(companies).set(patch).where(eq(companies.id, into.id));
    }

    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "company",
      entityId: into.id,
      companyId: into.id,
      dealId: into.id,
      type: "company.merged",
      summary: `${from.name} merged into ${into.name}`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: { fromCompanyId: from.id, fromCompanyName: from.name },
    });
    // archived source: consumers watching deal.* need a deal-level event so
    // the vanished pipeline card can be removed without polling
    await logActivity(ctx, tx, {
      workspaceId: session.workspaceId,
      entityType: "deal",
      entityId: from.id,
      companyId: from.id,
      dealId: from.id,
      type: "deal.archived",
      summary: `Deal "${from.name}" archived (merged into ${into.name})`,
      actor: session.actor.userId ? "user" : "system",
      actorUserId: session.actor.userId,
      data: { mergedIntoCompanyId: into.id, mergedIntoCompanyName: into.name },
    });

    return getCompany(ctx, session, into.id);
  }) as unknown as Promise<CompanyDto>;
}

/* ── relationship intelligence per company ────────────────────────── */

export async function listCompanyRelationships(
  ctx: CoreContext,
  session: Session,
  companyId: string,
) {
  const rows = await ctx.db
    .select({
      contactEmail: sql<string>`r.contact_email`,
      teamMemberName: sql<string | null>`u.name`,
      interactionCount: sql<number>`r.interaction_count`,
      lastInteractionAt: sql<string>`r.last_interaction_at`,
    })
    .from(sql`relationships r`)
    .leftJoin(sql`users u`, sql`u.id = r.team_member_user_id`)
    .where(sql`r.workspace_id = ${session.workspaceId} and r.company_id = ${companyId}`)
    .orderBy(sql`r.last_interaction_at desc`);
  return rows;
}
