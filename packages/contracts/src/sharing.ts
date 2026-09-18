import { z } from "zod";
import { idSchema } from "./common.js";

/* ── share links (public, trackable deal sharing) ──────────────────── */

export const createShareLinkSchema = z.object({
  companyId: idSchema,
  title: z.string().min(1).max(200),
  /** custom-field keys to expose; omit for the default safe set */
  attributes: z.array(z.string()).optional(),
  includeDocuments: z.boolean().default(true),
  password: z.string().min(4).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

export const updateShareLinkSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  attributes: z.array(z.string()).nullable().optional(),
  includeDocuments: z.boolean().optional(),
  password: z.string().nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  revoked: z.boolean().optional(),
});

export const shareLinkDto = z.object({
  id: idSchema,
  token: z.string(),
  url: z.string(),
  companyId: idSchema,
  company_name: z.string(),
  companyName: z.string(),
  title: z.string(),
  attributes: z.array(z.string()).nullable(),
  includeDocuments: z.boolean(),
  hasPassword: z.boolean(),
  expiresAt: z.string().nullable(),
  viewCount: z.number().int(),
  lastViewedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** Public shape returned by /share/:token after optional password check. */
export const publicCompanyViewSchema = z.object({
  title: z.string(),
  company: z.record(z.string(), z.unknown()),
  documents: z.array(
    z.object({ id: z.string(), name: z.string(), downloadUrl: z.string() }),
  ),
});

/* ── intake forms (website → pipeline) ─────────────────────────────── */

export const intakeFormDto = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  isActive: z.boolean(),
  fields: z.array(
    z.object({ key: z.string(), label: z.string(), required: z.boolean(), type: z.string() }),
  ),
});
export type IntakeFormDto = z.infer<typeof intakeFormDto>;

export const formSubmissionSchema = z.object({
  company_name: z.string().min(1),
  website: z.string().url().or(z.string().includes(".")).optional(),
  one_liner: z.string().optional(),
  deck_url: z.string().url().optional(),
}).catchall(z.union([z.string(), z.number()]));

/* ── api keys & credits ────────────────────────────────────────────── */

export const apiKeyDto = z.object({
  id: idSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  /** only present on creation */
  secret: z.string().optional(),
});

export const creditLedgerEntryDto = z.object({
  id: idSchema,
  delta: z.number().int(),
  reason: z.enum([
    "monthly_grant",
    "signup_grant",
    "deck_extraction",
    "email_triage",
    "update_classification",
    "assistant_turn",
    "link_conversion",
    "manual_adjustment",
  ]),
  refType: z.string().nullable(),
  balanceAfter: z.number().int(),
  createdAt: z.string(),
});

/* ── analytics ─────────────────────────────────────────────────────── */

export const analyticsOverviewSchema = z.object({
  activeDeals: z.number().int(),
  activeDealsDeltaPct: z.number(),
  totalPipelineUsd: z.number(),
  totalPipelineDeltaPct: z.number(),
  newFounders30d: z.number().int(),
  newFoundersDeltaPct: z.number(),
  conversionRatePct: z.number(),
  conversionDeltaPct: z.number(),
  byStage: z.array(
    z.object({ stageId: idSchema, stageName: z.string(), color: z.string(), count: z.number().int(), usd: z.number() }),
  ),
  weeklyIngestion: z.array(
    z.object({ weekStart: z.string(), deals: z.number().int() }),
  ),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

/* ── assistant ─────────────────────────────────────────────────────── */

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantRequestSchema = z.object({
  messages: z.array(assistantMessageSchema).min(1).max(40),
});
