import { z } from "zod";
import {
  idSchema,
  emailStatusSchema,
  parseStatusSchema,
  updateKindSchema,
  entitySourceSchema,
  fieldValuePrimitive,
} from "./common.js";

/* ── documents ─────────────────────────────────────────────────────── */

export const documentDto = z.object({
  id: idSchema,
  companyId: idSchema.nullable(),
  dealId: idSchema.nullable(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  pageCount: z.number().int().nullable(),
  sourceUrl: z.string().nullable(),
  source: z.enum(["upload", "link_conversion", "email_attachment"]),
  parseStatus: parseStatusSchema,
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof documentDto>;

/** POST /documents/from-link — queue a DocSend/Pitch/etc link for conversion. */
export const createDocumentFromLinkSchema = z.object({
  url: z.string().url(),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
  companyName: z.string().optional(),
});
export type CreateDocumentFromLinkInput = z.infer<typeof createDocumentFromLinkSchema>;

/* ── emails ────────────────────────────────────────────────────────── */

/**
 * Normalized inbound-email payload. Accepts both our Mailpit forwarder shape
 * and a flattened SES-inbound shape; the API adapter maps raw providers to this.
 */
export const inboundEmailPayload = z.object({
  messageId: z.string().min(1),
  from: z.object({
    email: z.string().email().or(z.string().includes("@")),
    name: z.string().nullish(),
  }),
  to: z.array(z.string()).min(1),
  subject: z.string().default(""),
  text: z.string().nullish(),
  html: z.string().nullish(),
  receivedAt: z.string().datetime({ offset: true }).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mime: z.string().default("application/octet-stream"),
        sizeBytes: z.number().int().optional(),
        contentBase64: z.string().optional(),
        storageKey: z.string().optional(),
      }),
    )
    .default([]),
});
export type InboundEmailPayload = z.infer<typeof inboundEmailPayload>;

export const emailDto = z.object({
  id: idSchema,
  direction: z.enum(["inbound", "outbound"]),
  channel: z.string(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  toEmails: z.array(z.string()),
  subject: z.string(),
  bodyText: z.string().nullable(),
  receivedAt: z.string(),
  processingStatus: emailStatusSchema,
  processedResult: z
    .object({
      matchedCompanies: z.array(z.string()).optional(),
      createdCompanies: z.array(z.string()).optional(),
      createdDeals: z.array(z.string()).optional(),
      portfolioUpdates: z.array(z.string()).optional(),
      confidence: z.number().optional(),
      summary: z.string().optional(),
    })
    .nullable(),
  error: z.string().nullable(),
});
export type EmailDto = z.infer<typeof emailDto>;

/* ── portfolio updates ─────────────────────────────────────────────── */

export const portfolioUpdateDto = z.object({
  id: idSchema,
  companyId: idSchema,
  companyName: z.string().optional(),
  title: z.string(),
  body: z.string().nullable(),
  kind: updateKindSchema,
  occurredAt: z.string(),
  source: entitySourceSchema,
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type PortfolioUpdateDto = z.infer<typeof portfolioUpdateDto>;

export const createPortfolioUpdateSchema = z.object({
  companyId: idSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  kind: updateKindSchema.default("update"),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

/* ── contacts ──────────────────────────────────────────────────────── */

export const contactDto = z.object({
  id: idSchema,
  companyId: idSchema.nullable(),
  name: z.string(),
  email: z.string().nullable(),
  title: z.string().nullable(),
  isFounder: z.boolean(),
});
export type ContactDto = z.infer<typeof contactDto>;

export const relationshipDto = z.object({
  companyId: idSchema,
  contactEmail: z.string(),
  teamMemberUserId: idSchema.nullable(),
  teamMemberName: z.string().nullable(),
  interactionCount: z.number().int(),
  lastInteractionAt: z.string(),
});

/* ── notes & activity ──────────────────────────────────────────────── */

export const noteDto = z.object({
  id: idSchema,
  authorUserId: idSchema.nullable(),
  authorName: z.string().nullable().optional(),
  companyId: idSchema.nullable(),
  dealId: idSchema.nullable(),
  body: z.string(),
  pinned: z.boolean(),
  createdAt: z.string(),
});
export type NoteDto = z.infer<typeof noteDto>;

export const createNoteSchema = z.object({
  body: z.string().min(1).max(10_000),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
  pinned: z.boolean().default(false),
});

export const activityDto = z.object({
  id: idSchema,
  entityType: z.string(),
  entityId: idSchema,
  companyId: idSchema.nullable(),
  dealId: idSchema.nullable(),
  type: z.string(),
  actor: z.enum(["user", "ai", "system"]),
  actorUserId: idSchema.nullable(),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type ActivityDto = z.infer<typeof activityDto>;

/* ── extraction view ───────────────────────────────────────────────── */

export const extractionDto = z.object({
  id: idSchema,
  kind: z.enum(["deck", "email", "update"]),
  status: z.enum(["pending", "running", "completed", "failed"]),
  model: z.string(),
  result: z.record(z.string(), z.unknown()).nullable(),
  confidence: z.number().nullable(),
  creditsUsed: z.number().int(),
  error: z.string().nullable(),
  documentId: idSchema.nullable(),
  emailId: idSchema.nullable(),
  companyId: idSchema.nullable(),
  dealId: idSchema.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

/** Payload used by agents/API to write AI-extracted data back. */
export const applyExtractionSchema = z.object({
  fields: z.record(z.string(), fieldValuePrimitive).optional(),
  company: z
    .object({
      sector: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional(),
      foundedYear: z.number().optional(),
      employeeCount: z.number().optional(),
    })
    .partial()
    .optional(),
  deal: z
    .object({
      roundStage: z.string().optional(),
      askAmount: z.number().nullable().optional(),
    })
    .partial()
    .optional(),
});
