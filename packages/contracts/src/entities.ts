import { z } from "zod";
import {
  companyStatusSchema,
  entitySourceSchema,
  fieldTypeSchema,
  fieldTargetSchema,
  stageKindSchema,
  memberRoleSchema,
  fieldValuePrimitive,
  idSchema,
} from "./common.js";

/* ── workspace / user ──────────────────────────────────────────────── */

export const userDto = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});
export type UserDto = z.infer<typeof userDto>;

export const workspaceDto = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  plan: z.enum(["trial", "monthly", "yearly", "custom"]),
  aiCreditsBalance: z.number().int(),
  members: z.array(userDto.extend({ role: memberRoleSchema })).default([]),
});
export type WorkspaceDto = z.infer<typeof workspaceDto>;

/* ── pipelines & stages ────────────────────────────────────────────── */

export const stageDto = z.object({
  id: idSchema,
  pipelineId: idSchema,
  name: z.string(),
  color: z.string(),
  kind: stageKindSchema,
  position: z.number().int(),
});
export type StageDto = z.infer<typeof stageDto>;

export const pipelineDto = z.object({
  id: idSchema,
  name: z.string(),
  isDefault: z.boolean(),
  position: z.number().int(),
  stages: z.array(stageDto),
});
export type PipelineDto = z.infer<typeof pipelineDto>;

export const createStageSchema = z.object({
  pipelineId: idSchema.optional(),
  name: z.string().min(1).max(80),
  color: z.string().default("#6366f1"),
  kind: stageKindSchema.default("active"),
});
export const updateStageSchema = createStageSchema.partial();
export const moveStageSchema = z.object({
  beforeStageId: idSchema.nullable(),
});

/* ── custom fields ─────────────────────────────────────────────────── */

export const customFieldDto = z.object({
  id: idSchema,
  target: fieldTargetSchema,
  key: z.string(),
  label: z.string(),
  type: fieldTypeSchema,
  options: z.array(z.string()).nullable().optional(),
  isRequired: z.boolean(),
  showInTable: z.boolean(),
  aiExtractable: z.boolean(),
  position: z.number().int(),
});
export type CustomFieldDto = z.infer<typeof customFieldDto>;

const createCustomFieldBase = z.object({
  target: fieldTargetSchema,
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case key")
    .max(64),
  label: z.string().min(1).max(80),
  type: fieldTypeSchema,
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().default(false),
  showInTable: z.boolean().default(true),
  aiExtractable: z.boolean().default(true),
});

export const createCustomFieldSchema = createCustomFieldBase.refine(
  (f) => !["select", "multi_select"].includes(f.type) || (f.options?.length ?? 0) > 0,
  { message: "select/multi_select require options", path: ["options"] },
);
export const createCustomFieldShape = createCustomFieldBase.shape;
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;
export const updateCustomFieldSchema = createCustomFieldBase.partial();

/* ── companies ─────────────────────────────────────────────────────── */

export const companyDto = z.object({
  id: idSchema,
  name: z.string(),
  domain: z.string().nullable(),
  sector: z.string().nullable(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  foundedYear: z.number().int().nullable(),
  employeeCount: z.number().int().nullable(),
  tags: z.array(z.string()),
  status: companyStatusSchema,
  source: entitySourceSchema,
  pipelineId: idSchema,
  stageId: idSchema,
  ownerUserId: idSchema.nullable(),
  roundStage: z.string().nullable(),
  askAmount: z.number().nullable(),
  valuation: z.number().nullable(),
  priority: z.number().int(),
  position: z.string(),
  nextStepAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  sourceRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** resolved custom field values keyed by field key */
  fields: z.record(z.string(), fieldValuePrimitive.nullable()).default({}),
});
export type CompanyDto = z.infer<typeof companyDto>;

export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(200).optional(),
  sector: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  foundedYear: z.coerce.number().int().min(1900).max(2100).optional(),
  employeeCount: z.coerce.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  status: companyStatusSchema.default("active"),
  /** when true and a name/domain match exists, update it instead of erroring */
  mergeWithExisting: z.boolean().optional(),
  pipelineId: idSchema.optional(),
  stageId: idSchema.optional(),
  ownerUserId: idSchema.nullable().optional(),
  roundStage: z.string().nullish(),
  askAmount: z.number().nonnegative().nullable().optional(),
  valuation: z.number().nonnegative().nullable().optional(),
  priority: z.number().int().min(0).max(5).optional(),
  nextStepAt: z.string().datetime({ offset: true }).nullish(),
  sourceRef: z.string().optional(),
  fields: z.record(z.string(), fieldValuePrimitive).optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
/** Input variant (defaults not yet applied) — used by internal callers that pass partial data. */
export type CreateCompanyValues = z.input<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema.partial();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const listCompaniesQuerySchema = z.object({
  q: z.string().optional(),
  status: companyStatusSchema.optional(),
  sector: z.array(z.string()).optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ── deals ─────────────────────────────────────────────────────────── */

export const dealDto = z.object({
  id: idSchema,
  companyId: idSchema,
  pipelineId: idSchema,
  stageId: idSchema,
  ownerUserId: idSchema.nullable(),
  title: z.string(),
  roundStage: z.string().nullable(),
  askAmount: z.number().nullable(),
  valuation: z.number().nullable(),
  priority: z.number().int(),
  tags: z.array(z.string()),
  position: z.string(),
  nextStepAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  source: entitySourceSchema,
  sourceRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** embedded company summary — same record as `id` after the company/deal merge */
  company: companyDto.pick({
    id: true,
    name: true,
    domain: true,
    sector: true,
    location: true,
    logoUrl: true,
    description: true,
    employeeCount: true,
    foundedYear: true,
  }),
  fields: z.record(z.string(), fieldValuePrimitive.nullable()).default({}),
});
export type DealDto = z.infer<typeof dealDto>;

export const roundStageEnum = z.enum([
  "Pre-seed",
  "Seed",
  "Series A",
  "Series B",
  "Series C",
  "Series D+",
]);

export const createDealSchema = z.object({
  companyId: idSchema.optional(),
  companyName: z.string().min(1).optional(),
  /** Alias of companyName — models often pass `name` like create_company. */
  name: z.string().min(1).optional(),
  domain: z.string().max(200).optional(),
  website: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  sector: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  linkedinUrl: z.string().url().optional(),
  pipelineId: idSchema.optional(),
  stageId: idSchema.optional(),
  ownerUserId: idSchema.nullable().optional(),
  title: z.string().optional(),
  roundStage: roundStageEnum.or(z.string()).nullish(),
  askAmount: z.number().nonnegative().nullable().optional(),
  valuation: z.number().nonnegative().nullable().optional(),
  priority: z.number().int().min(0).max(5).default(0),
  tags: z.array(z.string()).optional(),
  nextStepAt: z.string().datetime({ offset: true }).nullish(),
  sourceRef: z.string().optional(),
  fields: z.record(z.string(), fieldValuePrimitive).optional(),
});

/** Parse create-deal input, mapping `name` → companyName and requiring an identity. */
export const createDealInputSchema = createDealSchema
  .superRefine((d, ctx) => {
    if (!d.companyId && !(d.companyName ?? d.name ?? d.title)?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "companyId or companyName required",
        path: ["companyName"],
      });
    }
  })
  .transform((d) => ({
    ...d,
    companyName: d.companyName ?? d.name ?? d.title,
  }));
export type CreateDealInput = z.infer<typeof createDealInputSchema>;

export const updateDealSchema = z.object({
  stageId: idSchema.optional(),
  ownerUserId: idSchema.nullable().optional(),
  title: z.string().optional(),
  roundStage: z.string().nullable().optional(),
  askAmount: z.number().nullable().optional(),
  valuation: z.number().nullable().optional(),
  priority: z.number().int().optional(),
  tags: z.array(z.string()).optional(),
  nextStepAt: z.string().datetime({ offset: true }).nullable().optional(),
  archived: z.boolean().optional(),
  fields: z.record(z.string(), fieldValuePrimitive).optional(),
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const dealSortFields = [
  "position",
  "created_at",
  "updated_at",
  "ask_amount",
  "priority",
  "company_name",
] as const;

export const listDealsQuerySchema = z.object({
  q: z.string().optional(),
  pipelineId: idSchema.optional(),
  stageIds: z.array(idSchema).optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
  tags: z.array(z.string()).optional(),
  companyStatus: companyStatusSchema.optional(),
  ownerId: z.array(idSchema).optional(),
  source: z.array(entitySourceSchema).optional(),
  roundStage: z.array(z.string()).optional(),
  minAsk: z.coerce.number().optional(),
  maxAsk: z.coerce.number().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
  sort: z.enum(dealSortFields).default("position"),
  order: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

export const moveDealSchema = z.object({
  stageId: idSchema.optional(),
  beforeDealId: idSchema.nullable().optional(),
});
