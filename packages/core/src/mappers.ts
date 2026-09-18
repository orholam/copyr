import type {
  companies,
  stages,
  pipelines,
  customFields,
  documents,
  emailMessages,
  notes,
  activities,
  extractions,
  portfolioUpdates,
  users,
} from "@copyr/db/schema.js";
import type {
  CompanyDto,
  DealDto,
  StageDto,
  PipelineDto,
  CustomFieldDto,
  DocumentDto,
  EmailDto,
  NoteDto,
  ActivityDto,
  FieldValuePrimitive,
} from "@copyr/contracts";

type Select<T extends { $inferSelect: any }> = T["$inferSelect"];

export type CompanyRow = Select<typeof companies>;
export type DealRow = CompanyRow;
export type StageRow = Select<typeof stages>;
export type PipelineRow = Select<typeof pipelines>;
export type CustomFieldRow = Select<typeof customFields>;
export type DocumentRow = Select<typeof documents>;
export type EmailRow = Select<typeof emailMessages>;
export type NoteRow = Select<typeof notes>;
export type ActivityRow = Select<typeof activities>;
export type ExtractionRow = Select<typeof extractions>;
export type PortfolioUpdateRow = Select<typeof portfolioUpdates>;
export type UserRow = Select<typeof users>;

export function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** jsonb field value → primitive for transport. */
export function coerceFieldValue(v: unknown): FieldValuePrimitive | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function mapCompany(
  row: CompanyRow,
  fields: Record<string, unknown> = {},
): CompanyDto {
  const out: Record<string, FieldValuePrimitive | null> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = coerceFieldValue(v);
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    sector: row.sector,
    location: row.location,
    description: row.description,
    linkedinUrl: row.linkedinUrl,
    logoUrl: row.logoUrl,
    foundedYear: row.foundedYear,
    employeeCount: row.employeeCount,
    tags: row.tags ?? [],
    status: row.status,
    source: row.source,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    ownerUserId: row.ownerUserId,
    roundStage: row.roundStage,
    askAmount: row.askAmount === null ? null : Number(row.askAmount),
    valuation: row.valuation === null ? null : Number(row.valuation),
    priority: row.priority,
    position: row.position,
    nextStepAt: toIso(row.nextStepAt),
    archivedAt: toIso(row.archivedAt),
    sourceRef: row.sourceRef,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    fields: out,
  };
}

const dealCompanyPick = (c: CompanyRow) => ({
  id: c.id,
  name: c.name,
  domain: c.domain,
  sector: c.sector,
  location: c.location,
  logoUrl: c.logoUrl,
  description: c.description,
  employeeCount: c.employeeCount,
  foundedYear: c.foundedYear,
});

/** Pipeline-card view of a company. `id` === `companyId`. */
export function mapDeal(
  row: CompanyRow,
  _company?: CompanyRow,
  fields: Record<string, unknown> = {},
): DealDto {
  const company = _company ?? row;
  const out: Record<string, FieldValuePrimitive | null> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = coerceFieldValue(v);
  return {
    id: row.id,
    companyId: row.id,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    ownerUserId: row.ownerUserId,
    title: row.name,
    roundStage: row.roundStage,
    askAmount: row.askAmount === null ? null : Number(row.askAmount),
    valuation: row.valuation === null ? null : Number(row.valuation),
    priority: row.priority,
    tags: row.tags ?? [],
    position: row.position,
    nextStepAt: toIso(row.nextStepAt),
    archivedAt: toIso(row.archivedAt),
    source: row.source,
    sourceRef: row.sourceRef,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    company: dealCompanyPick(company),
    fields: out,
  };
}

export function mapStage(row: StageRow): StageDto {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    name: row.name,
    color: row.color,
    kind: row.kind,
    position: row.position,
  };
}

export function mapPipeline(row: PipelineRow, stageRows: StageRow[]): PipelineDto {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    position: row.position,
    stages: stageRows.map(mapStage),
  };
}

export function mapCustomField(row: CustomFieldRow): CustomFieldDto {
  return {
    id: row.id,
    target: row.target,
    key: row.key,
    label: row.label,
    type: row.type,
    options: row.options ?? null,
    isRequired: row.isRequired,
    showInTable: row.showInTable,
    aiExtractable: row.aiExtractable,
    position: row.position,
  };
}

export function mapDocument(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    companyId: row.companyId,
    dealId: row.dealId,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    sourceUrl: row.sourceUrl,
    source: row.source,
    parseStatus: row.parseStatus,
    createdAt: toIso(row.createdAt)!,
  };
}

export function mapEmail(row: EmailRow): EmailDto {
  return {
    id: row.id,
    direction: row.direction,
    channel: row.channel,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    toEmails: row.toEmails ?? [],
    subject: row.subject,
    bodyText: row.bodyText,
    receivedAt: toIso(row.receivedAt)!,
    processingStatus: row.processingStatus,
    processedResult:
      (row.processedResult as EmailDto["processedResult"]) ?? null,
    error: row.error,
  };
}

export function mapNote(row: NoteRow, authorName?: string | null): NoteDto {
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    authorName: authorName ?? null,
    companyId: row.companyId,
    dealId: row.dealId,
    body: row.body,
    pinned: row.pinned,
    createdAt: toIso(row.createdAt)!,
  };
}

export function mapActivity(row: ActivityRow): ActivityDto {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    companyId: row.companyId,
    dealId: row.dealId,
    type: row.type,
    actor: row.actor,
    actorUserId: row.actorUserId,
    summary: row.summary,
    data: (row.data as Record<string, unknown>) ?? null,
    createdAt: toIso(row.createdAt)!,
  };
}
