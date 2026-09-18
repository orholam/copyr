import { z } from "zod";

/* ── shared primitives ─────────────────────────────────────────────── */

export const idSchema = z.string().uuid();
export type Id = z.infer<typeof idSchema>;

export const isoDateTime = z.string().datetime({ offset: true }).or(z.string());
export const moneySchema = z.number().nonnegative();
/** Money is transported as number (dollars); stored numeric(14,2). */
export const nullableMoney = moneySchema.nullable().optional();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  });

/* ── enums (mirror DB) ─────────────────────────────────────────────── */

export const entitySourceSchema = z.enum([
  "manual",
  "email",
  "upload",
  "link",
  "form",
  "api",
  "agent",
  "seed",
]);
export type EntitySource = z.infer<typeof entitySourceSchema>;

export const companyStatusSchema = z.enum(["active", "portfolio", "passed", "archived"]);
export type CompanyStatus = z.infer<typeof companyStatusSchema>;

export const stageKindSchema = z.enum(["active", "won", "lost"]);
export type StageKind = z.infer<typeof stageKindSchema>;

export const fieldTargetSchema = z.enum(["deal", "company"]);
export type FieldTarget = z.infer<typeof fieldTargetSchema>;

export const fieldTypeSchema = z.enum([
  "text",
  "long_text",
  "number",
  "currency",
  "select",
  "multi_select",
  "date",
  "url",
  "checkbox",
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const activityActorSchema = z.enum(["user", "ai", "system"]);
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const emailStatusSchema = z.enum([
  "queued",
  "processing",
  "processed",
  "needs_review",
  "failed",
]);
export type EmailStatus = z.infer<typeof emailStatusSchema>;

export const parseStatusSchema = z.enum([
  "pending",
  "converting",
  "parsing",
  "parsed",
  "failed",
]);
export type ParseStatus = z.infer<typeof parseStatusSchema>;

export const updateKindSchema = z.enum([
  "milestone",
  "metric",
  "hiring",
  "funding",
  "news",
  "update",
]);
export type UpdateKind = z.infer<typeof updateKindSchema>;

export const memberRoleSchema = z.enum(["owner", "admin", "member"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

/* ── field values ──────────────────────────────────────────────────── */

export const fieldValuePrimitive = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export type FieldValuePrimitive = z.infer<typeof fieldValuePrimitive>;

export const setFieldValueSchema = z.object({
  key: z.string(),
  value: fieldValuePrimitive.nullable(),
});
export type SetFieldValueInput = z.infer<typeof setFieldValueSchema>;

/* ── actors: who is performing an action ───────────────────────────── */

export const actorSchema = z.object({
  /** null = system/automation */
  userId: idSchema.nullable().default(null),
  source: entitySourceSchema.default("api"),
});
export type Actor = z.infer<typeof actorSchema>;
