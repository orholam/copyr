import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ────────────────────────────── enums ─────────────────────────────── */

export const workspacePlan = pgEnum("workspace_plan", [
  "trial",
  "monthly",
  "yearly",
  "custom",
]);

export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);

export const entitySource = pgEnum("entity_source", [
  "manual",
  "email",
  "upload",
  "link",
  "form",
  "api",
  "agent",
  "seed",
]);

export const companyStatus = pgEnum("company_status", [
  "active",
  "portfolio",
  "passed",
  "archived",
]);

export const stageKind = pgEnum("stage_kind", ["active", "won", "lost"]);

export const fieldType = pgEnum("field_type", [
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

export const fieldTarget = pgEnum("field_target", ["deal", "company"]);

export const entityType = pgEnum("activity_entity", [
  "company",
  "deal",
  "document",
  "email",
  "note",
  "share_link",
  "portfolio_update",
  "contact",
  "stage",
  "pipeline",
  "custom_field",
  "workspace",
  "vault",
  "review_table",
  "agent",
  "agent_run",
  "space",
  "task",
  "memory",
  "research_report",
]);

export const activityActor = pgEnum("activity_actor", ["user", "ai", "system"]);

export const documentSource = pgEnum("document_source", [
  "upload",
  "link_conversion",
  "email_attachment",
]);

export const parseStatus = pgEnum("parse_status", [
  "pending",
  "converting",
  "parsing",
  "parsed",
  "failed",
]);

export const emailDirection = pgEnum("email_direction", ["inbound", "outbound"]);

export const emailStatus = pgEnum("email_status", [
  "queued",
  "processing",
  "processed",
  "needs_review",
  "failed",
]);

export const extractionKind = pgEnum("extraction_kind", [
  "deck",
  "email",
  "update",
]);

export const extractionStatus = pgEnum("extraction_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const updateKind = pgEnum("update_kind", [
  "milestone",
  "metric",
  "hiring",
  "funding",
  "news",
  "update",
]);

export const creditReason = pgEnum("credit_reason", [
  "monthly_grant",
  "signup_grant",
  "deck_extraction",
  "email_triage",
  "update_classification",
  "assistant_turn",
  "link_conversion",
  "manual_adjustment",
  "vault_review",
  "research_report",
  "agent_run",
]);

/* ── platform (vaults / agents / spaces / memory) ─────────────────── */

export const vaultStatus = pgEnum("vault_status", ["active", "archived"]);

export const reviewTableStatus = pgEnum("review_table_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const agentKind = pgEnum("agent_kind", [
  "thesis_screen",
  "diligence_checklist",
  "portfolio_monitor",
  "custom",
]);

export const agentRunStatus = pgEnum("agent_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const taskStatus = pgEnum("task_status", ["open", "in_progress", "done"]);

export const memoryKind = pgEnum("memory_kind", [
  "preference",
  "focus_area",
  "process",
  "fact",
]);

export const memorySource = pgEnum("memory_source", ["declared", "learned"]);

/* ──────────────────────────── identity ────────────────────────────── */

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    plan: workspacePlan("plan").notNull().default("trial"),
    aiCreditsBalance: integer("ai_credits_balance").notNull().default(500),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    /** extra capability grants beyond role defaults (RBAC permission sets) */
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    /** per-member UI/notification preferences */
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_ws_user_idx").on(t.workspaceId, t.userId)],
);

/* ─────────────────────────── pipeline ─────────────────────────────── */

export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pipelines_ws_idx").on(t.workspaceId)],
);

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: varchar("color", { length: 16 }).notNull().default("#6366f1"),
    kind: stageKind("kind").notNull().default("active"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stages_pipeline_idx").on(t.pipelineId, t.position)],
);

/* ─────────────────────── companies & deals ────────────────────────── */

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    sector: text("sector"),
    location: text("location"),
    description: text("description"),
    linkedinUrl: text("linkedin_url"),
    logoUrl: text("logo_url"),
    foundedYear: integer("founded_year"),
    employeeCount: integer("employee_count"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: companyStatus("status").notNull().default("active"),
    source: entitySource("source").notNull().default("manual"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    mergedIntoCompanyId: uuid("merged_into_company_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("companies_ws_idx").on(t.workspaceId, t.status),
    index("companies_ws_name_idx").on(t.workspaceId, t.name),
    index("companies_ws_domain_idx").on(t.workspaceId, t.domain),
  ],
);

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "restrict" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    roundStage: text("round_stage"),
    askAmount: numeric("ask_amount", { precision: 14, scale: 2 }),
    valuation: numeric("valuation", { precision: 14, scale: 2 }),
    priority: integer("priority").notNull().default(0),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** fractional-index ordering within stage for kanban */
    position: text("position").notNull().default("a0"),
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    source: entitySource("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deals_ws_pipeline_idx").on(t.workspaceId, t.pipelineId),
    index("deals_stage_idx").on(t.stageId, t.position),
    index("deals_company_idx").on(t.companyId),
  ],
);

/* ─────────────────────── custom fields ────────────────────────────── */

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    target: fieldTarget("target").notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    label: text("label").notNull(),
    type: fieldType("type").notNull(),
    options: jsonb("options").$type<string[]>(),
    isRequired: boolean("is_required").notNull().default(false),
    showInTable: boolean("show_in_table").notNull().default(true),
    aiExtractable: boolean("ai_extractable").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("custom_fields_ws_key_idx").on(t.workspaceId, t.target, t.key)],
);

export const fieldValues = pgTable(
  "field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    entityType: fieldTarget("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    value: jsonb("value"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    setByActor: activityActor("set_by_actor").notNull().default("user"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("field_values_unique_idx").on(
      t.fieldId,
      t.entityType,
      t.entityId,
    ),
    index("field_values_entity_idx").on(t.entityType, t.entityId),
  ],
);

/* ───────────────────── contacts & relationships ───────────────────── */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    email: text("email"),
    title: text("title"),
    isFounder: boolean("is_founder").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_ws_company_idx").on(t.workspaceId, t.companyId),
    index("contacts_email_idx").on(t.email),
  ],
);

/**
 * Derived from the email graph: which team member has interacted with a
 * company contact. Powers "relationship intelligence".
 */
export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactEmail: text("contact_email").notNull(),
    teamMemberUserId: uuid("team_member_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    teamMemberEmail: text("team_member_email"),
    interactionCount: integer("interaction_count").notNull().default(1),
    firstInteractionAt: timestamp("first_interaction_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("relationships_unique_idx").on(
      t.companyId,
      t.contactEmail,
      t.teamMemberEmail,
    ),
  ],
);

/* ───────────────────────── documents ─────────────────────────────── */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storageKey: text("storage_key"),
    pageCount: integer("page_count"),
    sourceUrl: text("source_url"),
    source: documentSource("source").notNull().default("upload"),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    textContent: text("text_content"),
    parseError: text("parse_error"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_ws_idx").on(t.workspaceId, t.createdAt),
    index("documents_company_idx").on(t.companyId),
    uniqueIndex("documents_source_url_idx").on(t.workspaceId, t.sourceUrl),
  ],
);

/* ─────────────────────────── emails ──────────────────────────────── */

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    direction: emailDirection("direction").notNull().default("inbound"),
    channel: text("channel").notNull().default("forward"), // forward | inbox | form | webhook
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmails: jsonb("to_emails").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    attachments: jsonb("attachments")
      .$type<
        Array<{
          filename: string;
          mime: string;
          sizeBytes?: number;
          storageKey?: string;
        }>
      >()
      .notNull()
      .default([]),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingStatus: emailStatus("processing_status").notNull().default("queued"),
    processedResult: jsonb("processed_result")
      .$type<{
        matchedCompanies?: string[];
        createdCompanies?: string[];
        createdDeals?: string[];
        portfolioUpdates?: string[];
        confidence?: number;
        summary?: string;
      }>(),
    error: text("error"),
    rawStorageKey: text("raw_storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("emails_ws_message_idx").on(t.workspaceId, t.messageId),
    index("emails_ws_status_idx").on(t.workspaceId, t.processingStatus),
    index("emails_from_idx").on(t.fromEmail),
  ],
);

/* ───────────────────── activities & notes ────────────────────────── */

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: entityType("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // e.g. deal.created, deal.stage_changed
    actor: activityActor("actor").notNull().default("system"),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("activities_ws_time_idx").on(t.workspaceId, t.createdAt),
    index("activities_deal_idx").on(t.dealId, t.createdAt),
    index("activities_company_idx").on(t.companyId, t.createdAt),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notes_company_idx").on(t.companyId),
    index("notes_deal_idx").on(t.dealId),
  ],
);

/* ─────────────────── extractions & AI credits ────────────────────── */

export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: extractionKind("kind").notNull(),
    status: extractionStatus("status").notNull().default("pending"),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    emailId: uuid("email_id").references(() => emailMessages.id, {
      onDelete: "cascade",
    }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    model: text("model").notNull().default("mock"),
    result: jsonb("result")
      .$type<Record<string, unknown> | null>()
      .default(null),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    creditsUsed: integer("credits_used").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("extractions_ws_idx").on(t.workspaceId, t.createdAt),
    index("extractions_document_idx").on(t.documentId),
    index("extractions_email_idx").on(t.emailId),
  ],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(), // negative = spend
    reason: creditReason("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_ledger_ws_idx").on(t.workspaceId, t.createdAt)],
);

/* ─────────────────────── portfolio updates ───────────────────────── */

export const portfolioUpdates = pgTable(
  "portfolio_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    kind: updateKind("kind").notNull().default("update"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: entitySource("source").notNull().default("manual"),
    sourceEmailId: uuid("source_email_id").references(() => emailMessages.id, {
      onDelete: "set null",
    }),
    data: jsonb("data").$type<Record<string, unknown> | null>().default(null),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portfolio_updates_ws_time_idx").on(t.workspaceId, t.occurredAt),
    index("portfolio_updates_company_idx").on(t.companyId, t.occurredAt),
  ],
);

/* ───────────────────────── share links ───────────────────────────── */

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 32 }).notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** attribute keys exposed publicly; null = default public set */
    attributes: jsonb("attributes").$type<string[] | null>(),
    includeDocuments: boolean("include_documents").notNull().default(true),
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("share_links_token_idx").on(t.token),
    index("share_links_ws_idx").on(t.workspaceId),
  ],
);

export const shareViews = pgTable(
  "share_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [index("share_views_link_idx").on(t.shareLinkId, t.viewedAt)],
);

/* ───────────────────── api keys & intake forms ───────────────────── */

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: varchar("prefix", { length: 12 }).notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["*"]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_prefix_idx").on(t.prefix),
    index("api_keys_ws_idx").on(t.workspaceId),
  ],
);

export const intakeForms = pgTable(
  "intake_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    landingStageId: uuid("landing_stage_id").references(() => stages.id, {
      onDelete: "set null",
    }),
    fields: jsonb("fields")
      .$type<
        Array<{ key: string; label: string; required: boolean; type: string }>
      >()
      .notNull()
      .default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("intake_forms_slug_idx").on(t.slug)],
);

/* ══════════════ diligence vaults & review tables ══════════════ */

export const vaults = pgTable(
  "vaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    status: vaultStatus("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vaults_ws_idx").on(t.workspaceId, t.status),
    index("vaults_company_idx").on(t.companyId),
    index("vaults_deal_idx").on(t.dealId),
  ],
);

export const vaultDocuments = pgTable(
  "vault_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vault_documents_unique_idx").on(t.vaultId, t.documentId),
    index("vault_documents_doc_idx").on(t.documentId),
  ],
);

/** Column spec for structured extraction across a vault's documents. */
export const reviewTables = pgTable(
  "review_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instruction: text("instruction"),
    columns: jsonb("columns")
      .$type<Array<{ key: string; label: string; type: string; description?: string }>>()
      .notNull()
      .default([]),
    status: reviewTableStatus("status").notNull().default("pending"),
    error: text("error"),
    creditsUsed: integer("credits_used").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("review_tables_vault_idx").on(t.vaultId),
    index("review_tables_ws_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const reviewRows = pgTable(
  "review_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewTableId: uuid("review_table_id")
      .notNull()
      .references(() => reviewTables.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    rowIndex: integer("row_index").notNull().default(0),
    data: jsonb("data")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    citations: jsonb("citations")
      .$type<Array<{ quote: string; locator?: string }>>()
      .notNull()
      .default([]),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_rows_table_idx").on(t.reviewTableId, t.rowIndex),
    index("review_rows_document_idx").on(t.documentId),
  ],
);

/* ══════════════ codified agents (Thesis Builder) ══════════════ */

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: agentKind("kind").notNull().default("custom"),
    description: text("description"),
    /** free-text thesis / instructions the agent reasons with */
    instructions: text("instructions"),
    /** structured knobs per kind: keywords, checklist templates, watch items */
    config: jsonb("config")
      .$type<{
        mustHaveKeywords?: string[];
        excludeKeywords?: string[];
        checklist?: string[];
        watchItems?: string[];
      }>()
      .notNull()
      .default({}),
    scheduleCron: varchar("schedule_cron", { length: 64 }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),
    version: integer("version").notNull().default(1),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agents_ws_idx").on(t.workspaceId, t.isActive),
    uniqueIndex("agents_ws_name_idx").on(t.workspaceId, t.name),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: agentRunStatus("status").notNull().default("queued"),
    trigger: varchar("trigger", { length: 24 }).notNull().default("manual"), // manual|schedule|task
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    spaceId: uuid("space_id"),
    taskId: uuid("task_id"),
    input: jsonb("input").$type<Record<string, unknown>>().default({}),
    output: jsonb("output").$type<Record<string, unknown> | null>().default(null),
    steps: jsonb("steps")
      .$type<Array<{ step: string; status: string; detail?: string; at: string }>>()
      .notNull()
      .default([]),
    creditsUsed: integer("credits_used").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_agent_idx").on(t.agentId, t.createdAt),
    index("agent_runs_ws_status_idx").on(t.workspaceId, t.status),
    index("agent_runs_company_idx").on(t.companyId),
  ],
);

/* ══════════════ spaces & tasks ══════════════ */

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary"),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id").references(() => vaults.id, { onDelete: "set null" }),
    contextSnapshot: jsonb("context_snapshot")
      .$type<Record<string, unknown> | null>()
      .default(null),
    isShared: boolean("is_shared").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("spaces_ws_idx").on(t.workspaceId, t.archivedAt),
    index("spaces_deal_idx").on(t.dealId),
    index("spaces_company_idx").on(t.companyId),
  ],
);

export const spaceParticipants = pgTable(
  "space_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    org: text("org"),
    role: varchar("role", { length: 16 }).notNull().default("viewer"), // viewer|editor
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("space_participants_unique_idx").on(t.spaceId, t.email)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail"),
    status: taskStatus("status").notNull().default("open"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** when set, completing the task routes work to a codified agent */
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    priority: integer("priority").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    position: text("position").notNull().default("a0"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_space_idx").on(t.spaceId, t.position),
    index("tasks_ws_status_idx").on(t.workspaceId, t.status),
    index("tasks_assignee_idx").on(t.assigneeUserId),
  ],
);

/* ══════════════ memory ══════════════ */

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** null = fund-wide memory shared by every member */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: memoryKind("kind").notNull().default("preference"),
    source: memorySource("source").notNull().default("declared"),
    content: text("content").notNull(),
    weight: integer("weight").notNull().default(1),
    pinned: boolean("pinned").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("memories_ws_idx").on(t.workspaceId, t.kind)],
);

/* ══════════════ grounded research reports ══════════════ */

export const researchReports = pgTable(
  "research_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    citations: jsonb("citations")
      .$type<
        Array<{
          sourceType: string;
          sourceId: string;
          sourceName: string;
          quote: string;
        }>
      >()
      .notNull()
      .default([]),
    scopeCompanyId: uuid("scope_company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    scopeDealId: uuid("scope_deal_id").references(() => deals.id, {
      onDelete: "cascade",
    }),
    scopeVaultId: uuid("scope_vault_id").references(() => vaults.id, {
      onDelete: "cascade",
    }),
    model: text("model").notNull().default("mock"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    creditsUsed: integer("credits_used").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("research_reports_ws_idx").on(t.workspaceId, t.createdAt),
    index("research_reports_company_idx").on(t.scopeCompanyId),
  ],
);

/* ══════════════ assistant (central chat surface) ══════════════ */

export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "tool",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull().default("New conversation"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_ws_idx").on(t.workspaceId, t.lastMessageAt),
    index("conversations_user_idx").on(t.userId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    /** user text / assistant reply / tool result payload */
    content: text("content").notNull().default(""),
    /** assistant: toolCalls; tool: {name, args, ok} */
    data: jsonb("data")
      .$type<
        | {
            toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
          }
        | { name?: string; args?: Record<string, unknown>; ok?: boolean }
        | null
      >()
      .default(null),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.position),
    index("messages_ws_idx").on(t.workspaceId, t.createdAt),
  ],
);


/* ───────────────────── automation & outbound webhooks ────────────── */

export const workflowTriggerEvent = pgEnum("workflow_trigger_event", [
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
  "agent_run.completed",
]);

export const workflowRunStatus = pgEnum("workflow_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

/** A user-defined automation: WHEN <triggerEvent> IF <conditions> THEN <actions>. */
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    triggerEvent: workflowTriggerEvent("trigger_event").notNull(),
    conditions: jsonb("conditions")
      .$type<
        Array<{
          field: string; // dot-path into the event snapshot, e.g. "deal.askAmount"
          op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "exists";
          value?: unknown;
        }>
      >()
      .notNull()
      .default([]),
    actions: jsonb("actions")
      .$type<
        Array<{
          type:
            | "add_note"
            | "move_deal"
            | "set_deal_fields"
            | "set_company_fields"
            | "create_portfolio_update"
            | "run_agent";
          config: Record<string, unknown>;
        }>
      >()
      .notNull()
      .default([]),
    isEnabled: boolean("is_enabled").notNull().default(true),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflows_ws_idx").on(t.workspaceId, t.isEnabled)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    triggerEvent: text("trigger_event").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    status: workflowRunStatus("status").notNull().default("pending"),
    steps: jsonb("steps")
      .$type<
        Array<{
          actionIndex: number;
          type: string;
          status: "ok" | "error" | "skipped";
          detail?: string;
          at: string;
        }>
      >()
      .notNull()
      .default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("workflow_runs_ws_idx").on(t.workspaceId, t.createdAt),
    index("workflow_runs_workflow_idx").on(t.workflowId, t.createdAt),
  ],
);

/**
 * Outbound webhook subscription: Copyr PUSHes matching events to the URL,
 * HMAC-signed with `secret` (X-Copyr-Signature), retried with backoff.
 */
export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<string[]>().notNull().default(["*"]),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_subs_ws_idx").on(t.workspaceId, t.isActive)],
);

export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    responseStatus: integer("response_status"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_sub_idx").on(t.subscriptionId, t.createdAt),
    index("webhook_deliveries_status_idx").on(t.status),
  ],
);


/* ─────────────────────────── saved views ──────────────────────────── */

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** which list this view applies to; extensible beyond deals */
    resource: text("resource").notNull().default("deals"),
    query: jsonb("query").$type<Record<string, string>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("saved_views_ws_idx").on(t.workspaceId),
    uniqueIndex("saved_views_ws_name_idx").on(t.workspaceId, t.name),
  ],
);
