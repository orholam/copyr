import { z } from "zod";
import { idSchema } from "./common.js";

/* ══════════════ diligence vaults ══════════════ */

export const vaultDto = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  companyId: idSchema.nullable(),
  dealId: idSchema.nullable(),
  status: z.enum(["active", "archived"]),
  documentCount: z.number().int().default(0),
  parsedDocumentCount: z.number().int().default(0),
  reviewTableCount: z.number().int().default(0),
  createdByUserId: idSchema.nullable(),
  createdAt: z.string(),
});
export type VaultDto = z.infer<typeof vaultDto>;

export const createVaultSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
});
export type CreateVaultInput = z.infer<typeof createVaultSchema>;

export const updateVaultSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

/* ── review tables (structured extraction over a vault) ─────────── */

export const reviewColumnSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "number", "currency", "date", "boolean"]).default("text"),
  description: z.string().max(300).optional(),
});
export type ReviewColumn = z.infer<typeof reviewColumnSchema>;

export const reviewTableDto = z.object({
  id: idSchema,
  vaultId: idSchema,
  name: z.string(),
  instruction: z.string().nullable(),
  columns: z.array(reviewColumnSchema),
  status: z.enum(["pending", "running", "completed", "failed"]),
  error: z.string().nullable(),
  creditsUsed: z.number().int(),
  rowCount: z.number().int().default(0),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ReviewTableDto = z.infer<typeof reviewTableDto>;

export const createReviewTableSchema = z
  .object({
    vaultId: idSchema,
    name: z.string().min(1).max(160),
    instruction: z.string().max(2000).optional(),
    columns: z.array(reviewColumnSchema).min(1).max(20),
    /** run synchronously instead of via background job (small vaults) */
    waitForCompletion: z.boolean().default(false),
  })
  .refine(
    (t) => new Set(t.columns.map((c) => c.key)).size === t.columns.length,
    { message: "column keys must be unique" },
  );
export type CreateReviewTableInput = z.infer<typeof createReviewTableSchema>;

export const reviewRowDto = z.object({
  id: idSchema,
  reviewTableId: idSchema,
  documentId: idSchema.nullable(),
  documentName: z.string().nullable().optional(),
  rowIndex: z.number().int(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  citations: z.array(z.object({ quote: z.string(), locator: z.string().optional() })),
  confidence: z.number().nullable(),
  locked: z.boolean(),
});
export type ReviewRowDto = z.infer<typeof reviewRowDto>;

/* ══════════════ codified agents ══════════════ */

export const agentKindSchema = z.enum([
  "thesis_screen",
  "diligence_checklist",
  "portfolio_monitor",
  "custom",
]);
export type AgentKind = z.infer<typeof agentKindSchema>;

export const agentConfigSchema = z.object({
  mustHaveKeywords: z.array(z.string()).max(50).default([]),
  excludeKeywords: z.array(z.string()).max(50).default([]),
  checklist: z.array(z.string().max(200)).max(50).default([]),
  watchItems: z.array(z.string().max(200)).max(50).default([]),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const agentDto = z.object({
  id: idSchema,
  name: z.string(),
  kind: agentKindSchema,
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  config: agentConfigSchema,
  scheduleCron: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  version: z.number().int(),
  runCount: z.number().int(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentDto = z.infer<typeof agentDto>;

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  kind: agentKindSchema.default("custom"),
  description: z.string().max(500).optional(),
  instructions: z.string().max(8000).optional(),
  config: agentConfigSchema.optional(),
  scheduleCron: z.string().max(64).nullable().optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = createAgentSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const runAgentSchema = z.object({
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
  spaceId: idSchema.optional(),
  taskId: idSchema.optional(),
  trigger: z.enum(["manual", "schedule", "task", "workflow"]).default("manual"),
});
export type RunAgentInput = z.infer<typeof runAgentSchema>;

export const agentRunDto = z.object({
  id: idSchema,
  agentId: idSchema,
  agentName: z.string().optional(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  trigger: z.string(),
  companyId: idSchema.nullable(),
  companyName: z.string().nullable().optional(),
  dealId: idSchema.nullable(),
  taskId: idSchema.nullable(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  steps: z.array(
    z.object({ step: z.string(), status: z.string(), detail: z.string().optional(), at: z.string() }),
  ),
  creditsUsed: z.number().int(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentRunDto = z.infer<typeof agentRunDto>;

/* ══════════════ spaces & tasks ══════════════ */

export const spaceParticipantDto = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string().nullable(),
  org: z.string().nullable(),
  role: z.string(),
});
export type SpaceParticipantDto = z.infer<typeof spaceParticipantDto>;

export const taskDto = z.object({
  id: idSchema,
  spaceId: idSchema.nullable(),
  companyId: idSchema.nullable(),
  dealId: idSchema.nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  status: z.enum(["open", "in_progress", "done"]),
  assigneeUserId: idSchema.nullable(),
  assigneeName: z.string().nullable().optional(),
  assigneeAgentId: idSchema.nullable(),
  assigneeAgentName: z.string().nullable().optional(),
  priority: z.number().int(),
  dueAt: z.string().nullable(),
  position: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TaskDto = z.infer<typeof taskDto>;

export const spaceSummaryDto = z.object({
  id: idSchema,
  name: z.string(),
  summary: z.string().nullable(),
  companyId: idSchema.nullable(),
  companyName: z.string().nullable().optional(),
  dealId: idSchema.nullable(),
  vaultId: idSchema.nullable(),
  isShared: z.boolean(),
  openTaskCount: z.number().int().default(0),
  participantCount: z.number().int().default(0),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SpaceSummaryDto = z.infer<typeof spaceSummaryDto>;

/** Full context bundle — everything an agent or teammate needs to pick up the work. */
export const spaceDetailDto = spaceSummaryDto.extend({
  company: z.unknown().nullable(),
  deals: z.array(z.unknown()),
  documents: z.array(z.unknown()),
  notes: z.array(z.unknown()),
  portfolioUpdates: z.array(z.unknown()),
  tasks: z.array(taskDto),
  participants: z.array(spaceParticipantDto),
  recentActivity: z.array(z.unknown()),
});
export type SpaceDetailDto = z.infer<typeof spaceDetailDto>;

export const createSpaceSchema = z.object({
  name: z.string().min(1).max(160),
  summary: z.string().max(4000).optional(),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
  vaultId: idSchema.optional(),
  /** auto-attach latest vault + provision standard diligence checklist */
  provisionChecklist: z.boolean().default(true),
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  summary: z.string().max(4000).nullable().optional(),
  isShared: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const addParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  org: z.string().optional(),
  role: z.enum(["viewer", "editor"]).default("viewer"),
});

export const createTaskSchema = z.object({
  title: z.string().min(1).max(240),
  detail: z.string().max(4000).optional(),
  spaceId: idSchema.optional(),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
  assigneeUserId: idSchema.nullable().optional(),
  /** routes completion of this task to a codified agent run */
  assigneeAgentId: idSchema.nullable().optional(),
  priority: z.number().int().min(0).max(5).default(0),
  dueAt: z.string().datetime({ offset: true }).nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  detail: z.string().max(4000).nullable().optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  assigneeUserId: idSchema.nullable().optional(),
  assigneeAgentId: idSchema.nullable().optional(),
  priority: z.number().int().min(0).max(5).optional(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/* ══════════════ memory ══════════════ */

export const memoryDto = z.object({
  id: idSchema,
  userId: idSchema.nullable(),
  kind: z.enum(["preference", "focus_area", "process", "fact"]),
  source: z.enum(["declared", "learned"]),
  content: z.string(),
  weight: z.number().int(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryDto = z.infer<typeof memoryDto>;

export const createMemorySchema = z.object({
  content: z.string().min(1).max(1000),
  kind: z.enum(["preference", "focus_area", "process", "fact"]).default("preference"),
  userId: idSchema.nullable().optional(),
  pinned: z.boolean().default(false),
});
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

/* ══════════════ grounded research ══════════════ */

export const researchReportDto = z.object({
  id: idSchema,
  question: z.string(),
  answer: z.string(),
  citations: z.array(
    z.object({
      sourceType: z.string(),
      sourceId: z.string(),
      sourceName: z.string(),
      quote: z.string(),
    }),
  ),
  scopeCompanyId: idSchema.nullable(),
  scopeDealId: idSchema.nullable(),
  scopeVaultId: idSchema.nullable(),
  model: z.string(),
  confidence: z.number().nullable(),
  creditsUsed: z.number().int(),
  createdAt: z.string(),
});
export type ResearchReportDto = z.infer<typeof researchReportDto>;

export const askResearchSchema = z.object({
  question: z.string().min(3).max(600),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
  vaultId: idSchema.optional(),
  /** include fund memories + team notes in grounding (default true) */
  includeFirmContext: z.boolean().default(true),
});
export type AskResearchInput = z.infer<typeof askResearchSchema>;

/* ══════════════ assistant (central chat) ══════════════ */

export const assistantToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type AssistantToolCall = z.infer<typeof assistantToolCallSchema>;

export const messageDto = z.object({
  id: idSchema,
  conversationId: idSchema,
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  toolCalls: z.array(assistantToolCallSchema).nullish(),
  toolName: z.string().nullish(),
  toolArgs: z.record(z.string(), z.unknown()).nullish(),
  ok: z.boolean().nullish(),
  position: z.number().int(),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof messageDto>;

export const conversationDto = z.object({
  id: idSchema,
  userId: idSchema.nullable(),
  title: z.string(),
  lastMessageAt: z.string(),
  messageCount: z.number().int().default(0),
  createdAt: z.string(),
});
export type ConversationDto = z.infer<typeof conversationDto>;

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
