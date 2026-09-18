import { z } from "zod";
import { idSchema } from "./common.js";

/* ── workflow conditions & actions ─────────────────────────────────── */

export const conditionOpSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "exists",
]);

export const workflowConditionSchema = z.object({
  /** dot-path into the event snapshot, e.g. "deal.askAmount", "company.sector" */
  field: z.string().min(1).max(120),
  op: conditionOpSchema,
  value: z.unknown().optional(),
});

export const workflowActionTypeSchema = z.enum([
  "add_note",
  "move_deal",
  "set_deal_fields",
  "set_company_fields",
  "create_portfolio_update",
  /** dispatch a codified agent scoped to the event's entity */
  "run_agent",
]);

export const workflowActionSchema = z.object({
  type: workflowActionTypeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
});

export const TRIGGER_EVENTS = [
  "company.created",
  "company.updated",
  "deal.created",
  "deal.stage_changed",
  "deal.updated",
  "email.processed",
  "email.needs_review",
  "document.parsed",
  "extraction.completed",
  "note.added",
  "portfolio_update.created",
  /** a codified agent finished — conditions can gate on its output */
  "agent_run.completed",
] as const;

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  triggerEvent: z.enum(TRIGGER_EVENTS),
  conditions: z.array(workflowConditionSchema).max(10).default([]),
  actions: z.array(workflowActionSchema).min(1).max(10),
  isEnabled: z.boolean().default(true),
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export const updateWorkflowSchema = createWorkflowSchema.partial();

export const workflowDto = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  triggerEvent: z.string(),
  conditions: z.array(workflowConditionSchema),
  actions: z.array(workflowActionSchema),
  isEnabled: z.boolean(),
  runCount: z.number().int(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WorkflowDto = z.infer<typeof workflowDto>;

export const workflowRunDto = z.object({
  id: idSchema,
  workflowId: idSchema,
  workflowName: z.string().optional(),
  triggerEvent: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  steps: z.array(
    z.object({
      actionIndex: z.number().int(),
      type: z.string(),
      status: z.enum(["ok", "error", "skipped"]),
      detail: z.string().optional(),
      at: z.string(),
    }),
  ),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type WorkflowRunDto = z.infer<typeof workflowRunDto>;

/* ── outbound webhook subscriptions ───────────────────────────────── */

export const createWebhookSubscriptionSchema = z.object({
  url: z.string().url(),
  events: z
    .array(z.string())
    .min(1)
    .default(["*"]),
  description: z.string().max(300).optional(),
});
export type CreateWebhookSubscriptionInput = z.infer<typeof createWebhookSubscriptionSchema>;
export const updateWebhookSubscriptionSchema = createWebhookSubscriptionSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const webhookSubscriptionDto = z.object({
  id: idSchema,
  url: z.string(),
  events: z.array(z.string()),
  description: z.string().nullable(),
  isActive: z.boolean(),
  failureCount: z.number().int(),
  lastDeliveryAt: z.string().nullable(),
  lastStatus: z.number().int().nullable(),
  createdAt: z.string(),
  /** shown once on creation */
  secret: z.string().optional(),
});
export type WebhookSubscriptionDto = z.infer<typeof webhookSubscriptionDto>;

export const webhookDeliveryDto = z.object({
  id: idSchema,
  subscriptionId: idSchema,
  event: z.string(),
  status: z.enum(["pending", "delivered", "failed"]),
  responseStatus: z.number().int().nullable(),
  attempts: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
});

/* ── saved pipeline views ──────────────────────────────────────────── */

export const savedViewDto = z.object({
  id: idSchema,
  name: z.string(),
  resource: z.string(),
  query: z.record(z.string(), z.string()),
  createdAt: z.string(),
});
export type SavedViewDto = z.infer<typeof savedViewDto>;

export const createSavedViewSchema = z.object({
  name: z.string().min(1).max(80),
  query: z.record(z.string(), z.string()).default({}),
});
