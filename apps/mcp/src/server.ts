import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Core, Session } from "@copyr/core";
import {
  createDealSchema,
  updateDealSchema,
  listDealsQuerySchema,
  createCompanySchema,
  updateCompanySchema,
  createCustomFieldSchema,
  createCustomFieldShape,
  createShareLinkSchema,
  inboundEmailPayload,
  globalSearchQuerySchema,
  listCompaniesQuerySchema,
  createVaultSchema,
  createReviewTableSchema,
  askResearchSchema,
  createAgentSchema,
  updateAgentSchema,
  runAgentSchema,
  createSpaceSchema,
  createTaskSchema,
  updateTaskSchema,
  createMemorySchema,
  sendMessageSchema,
  updateStageSchema,
  updateCustomFieldSchema,
  updateWorkflowSchema,
  updateWebhookSubscriptionSchema,
  updateShareLinkSchema,
  updateVaultSchema,
} from "@copyr/contracts";
import { requireSession } from "./session.js";

const uuid = z.string().uuid();
const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/** Wrap handlers so tool errors become readable tool results, never crashes. */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> => {
    try {
      const data = await fn(args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  };
}

/**
 * The VentureLabs MCP server: every product capability, exposed to agents.
 * Tools read the tenant session from AsyncLocalStorage (see ./session.ts).
 */
export function createCopyrMcpServer(core: Core): McpServer {
  const server = new McpServer(
    { name: "venturelabs", version: "0.1.0" },
    {
      instructions:
        "VentureLabs is an AI-native operating platform for venture funds: deal flow, diligence, and portfolio operations.\n" +
        "Surfaces: (1) PIPELINE — pipelines/stages/deals/companies/contacts with custom fields; ingest pitch emails, deck links, " +
        "PDFs or public intake forms (AI triage + extraction run automatically). (2) VAULTS — bulk diligence: create_vault, add documents, then " +
        "create_review_table extracts structured rows with citations across every parsed document in one query. " +
        "(3) KNOWLEDGE — ask_knowledge answers questions grounded in workspace material with citations. " +
        "(4) AGENTS — codify fund judgment via create_agent (thesis screens, diligence checklists, portfolio monitors); run_agent executes end-to-end and writes review-ready output; automations_overview shows everything running autonomously. " +
        "(5) SPACES — get_space returns the full context bundle for a matter so work never starts from scratch; tasks route to teammates or agents. " +
        "(6) MEMORY — remember/recall fund preferences that scope every answer. " +
        "(7) COMMAND CENTER — command_center_overview for adoption, benchmarking and recommendations.\n" +
        "Admin surfaces: API keys, intake forms, notification prefs, webhook subscriptions, share links — full create/update/delete lifecycle on every entity.\n" +
        "Typical diligence flow: create_vault → add_documents_to_vault → poll until parsed → create_review_table → " +
        "get_review_table rows with quotes → ask_knowledge for synthesis → run_agent(thesis_screen) for the fit score.",
    },
  );

  /* ───────────────────── workspace ───────────────────── */

  server.tool(
    "get_workspace_info",
    "Get workspace name/plan/credits balance and team members",
    {},
    tool(async () => {
      const s = requireSession();
      return core.session.getWorkspace(core.ctx, s.workspaceId);
    }),
  );

  server.tool(
    "list_credit_ledger",
    "Recent AI credit ledger entries (grants + spends)",
    { limit: z.number().int().min(1).max(100).default(20) },
    tool(async ({ limit }) =>
      (await core.session.listCreditLedger(core.ctx, requireSession().workspaceId)).slice(0, limit),
    ),
  );

  server.tool(
    "list_api_keys",
    "All workspace API keys (prefix + status only — secrets are never retrievable after creation)",
    {},
    tool(async () => core.session.listApiKeys(core.ctx, requireSession())),
  );

  server.tool(
    "create_api_key",
    "Mint a new API key for programmatic access. The secret is shown exactly once in the response.",
    { name: z.string().min(1) },
    tool(async ({ name }) => core.session.createApiKey(core.ctx, requireSession(), name)),
  );

  server.tool(
    "revoke_api_key",
    "Revoke an API key immediately (irreversible)",
    { keyId: uuid },
    tool(async ({ keyId }) => {
      await core.session.revokeApiKey(core.ctx, requireSession(), keyId);
      return { ok: true };
    }),
  );

  server.tool(
    "get_my_permissions",
    "Effective permission set for the current caller (manage_pipeline, manage_fields, manage_automations, manage_webhooks, manage_team, manage_billing, export_data)",
    {},
    tool(async () => {
      const perms = await core.session.memberPermissions(core.ctx, requireSession());
      return { permissions: [...perms] };
    }),
  );

  server.tool(
    "get_notification_prefs",
    "Current user's notification preferences (empty object when called with an API key)",
    {},
    tool(async () => core.session.getNotificationPrefs(core.ctx, requireSession())),
  );

  server.tool(
    "update_notification_prefs",
    "Replace the current user's notification preferences (e.g. { dealStageChanged: true, weeklyDigest: false })",
    { notifications: z.record(z.string(), z.unknown()) },
    tool(async ({ notifications }) =>
      core.session.updateNotificationPrefs(core.ctx, requireSession(), notifications),
    ),
  );

  server.tool(
    "list_intake_forms",
    "Public pitch-intake forms with slugs and landing stages (website → pipeline)",
    {},
    tool(async () => core.session.listIntakeForms(core.ctx, requireSession())),
  );

  server.tool(
    "create_intake_form",
    "Create a public intake form. Submissions create/dedupe a company and open a deal in the landing stage (default: first stage of the default pipeline).",
    {
      name: z.string().min(1),
      landingStageId: uuid.optional(),
    },
    tool(async ({ name, landingStageId }) =>
      core.session.createIntakeForm(core.ctx, requireSession(), {
        name,
        ...(landingStageId ? { landingStageId } : {}),
      }),
    ),
  );

  server.tool(
    "submit_intake_form",
    "Submit to an intake form by slug (same path the public website form uses). Standard keys: company_name, website, one_liner, round, deck_url.",
    {
      slug: z.string().min(1),
      values: z.record(z.string(), z.string()),
    },
    tool(async ({ slug, values }) =>
      core.session.submitIntakeForm(core.ctx, slug, values),
    ),
  );

  /* ───────────────────── pipeline & deals ───────────────────── */

  server.tool(
    "list_pipelines",
    "List pipelines with ordered stages — the kanban board definition",
    {},
    tool(async () => core.pipelines.listPipelines(core.ctx, requireSession())),
  );

  server.tool(
    "create_stage",
    "Create a pipeline stage",
    {
      name: z.string().min(1),
      pipelineId: uuid.optional(),
      color: z.string().optional(),
      kind: z.enum(["active", "won", "lost"]).default("active"),
    },
    tool(async (args) => core.pipelines.createStage(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "update_stage",
    "Rename/re-color a stage or change its kind (active|won|lost)",
    { ...updateStageSchema.shape, stageId: uuid },
    tool(async (args) => {
      const { stageId, ...patch } = updateStageSchema.extend({ stageId: uuid }).parse(args);
      if (!stageId) throw new Error("stageId required");
      return core.pipelines.updateStage(core.ctx, requireSession(), stageId, patch);
    }),
  );

  server.tool(
    "delete_stage",
    "Delete an empty pipeline stage (refuses when deals are still in it — move them first)",
    { stageId: uuid },
    tool(async ({ stageId }) => {
      await core.pipelines.deleteStage(core.ctx, requireSession(), stageId);
      return { ok: true };
    }),
  );

  server.tool(
    "list_deals",
    "Query deals. Filters: q, stageIds, ownerId, source, roundStage, minAsk/maxAsk, archived",
    { ...listDealsQuerySchema.shape },
    tool(async (args) => {
      const query = listDealsQuerySchema.parse(args);
      return core.deals.listDeals(core.ctx, requireSession(), query);
    }),
  );

  server.tool(
    "get_deal",
    "Get one deal incl. embedded company summary and resolved custom field values",
    { dealId: uuid },
    tool(async ({ dealId }) => core.deals.getDeal(core.ctx, requireSession(), dealId)),
  );

  server.tool(
    "create_deal",
    "Create a deal. Pass companyId OR companyName (company auto-created/deduped). Custom fields via `fields` keyed by field key.",
    { ...createDealSchema.shape },
    tool(async (args) => {
      const input = createDealSchema.parse(args);
      return core.deals.createDeal(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "update_deal",
    "Update a deal: stageId, owner, title, roundStage, askAmount, priority, nextStepAt, archived, fields",
    { ...updateDealSchema.shape, dealId: uuid },
    tool(async (args) => {
      const { dealId, ...patch } = updateDealSchema.extend({ dealId: uuid }).parse(args);
      if (!dealId) throw new Error("dealId required");
      return core.deals.updateDeal(core.ctx, requireSession(), dealId, patch);
    }),
  );

  server.tool(
    "move_deal",
    "Move a deal to another stage and/or position it before a given deal (kanban semantics)",
    {
      dealId: uuid,
      stageId: uuid.optional(),
      beforeDealId: uuid.nullable().optional(),
    },
    tool(async ({ dealId, stageId, beforeDealId }) =>
      core.deals.moveDeal(core.ctx, requireSession(), dealId!, {
        stageId: stageId ?? undefined,
        beforeDealId,
      }),
    ),
  );

  /* ───────────────────── companies & fields ───────────────────── */

  server.tool(
    "search_companies",
    "Search companies by name/domain/sector; filter by status",
    { ...listCompaniesQuerySchema.shape },
    tool(async (args) => {
      const q = listCompaniesQuerySchema.parse(args ?? {});
      return core.companies.listCompanies(core.ctx, requireSession(), q);
    }),
  );

  server.tool(
    "get_company",
    "Get a company incl. resolved custom field values",
    { companyId: uuid },
    tool(async ({ companyId }) => core.companies.getCompany(core.ctx, requireSession(), companyId)),
  );

  server.tool(
    "create_company",
    "Create a company. Required args: name. Optional: domain, sector, location, description, fields.",
    { ...createCompanySchema.shape },
    tool(async (args) => {
      const input = createCompanySchema.parse(args);
      return core.companies.createCompany(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "update_company",
    "Update company attributes/status and custom field values",
    { ...updateCompanySchema.shape, companyId: uuid },
    tool(async (args) => {
      const { companyId, ...patch } = updateCompanySchema.extend({ companyId: uuid }).parse(args);
      if (!companyId) throw new Error("companyId required");
      return core.companies.updateCompany(core.ctx, requireSession(), companyId, patch);
    }),
  );

  server.tool(
    "delete_company",
    "Delete a company permanently (cascades its deals, documents and notes — prefer status=archived for soft removal)",
    { companyId: uuid },
    tool(async ({ companyId }) => {
      await core.companies.deleteCompany(core.ctx, requireSession(), companyId);
      return { ok: true };
    }),
  );

  server.tool(
    "list_contacts",
    "People attached to a company (founders, execs, referrals)",
    { companyId: uuid },
    tool(async ({ companyId }) =>
      core.companies.listContacts(core.ctx, requireSession(), companyId),
    ),
  );

  server.tool(
    "add_contact",
    "Create or update a contact by email. Mark isFounder=true to flag founders.",
    {
      name: z.string().min(1),
      email: z.string().email().optional(),
      title: z.string().optional(),
      isFounder: z.boolean().default(false),
      companyId: uuid.optional(),
    },
    tool(async (args) => {
      const { name, email, title, isFounder, companyId } = args;
      return core.db.transaction((tx) =>
        core.companies.upsertContact(core.ctx, tx, requireSession(), {
          name: name!,
          ...(email ? { email } : { email: null }),
          ...(title ? { title } : { title: null }),
          isFounder,
          ...(companyId ? { companyId } : { companyId: null }),
        }),
      );
    }),
  );

  server.tool(
    "list_custom_fields",
    "List workspace custom-field definitions (key, label, type, options)",
    {},
    tool(async () => core.fields.listCustomFields(core.ctx, requireSession())),
  );

  server.tool(
    "create_custom_field",
    "Define a new custom attribute for deals or companies. select types require options[].",
    { ...createCustomFieldShape },
    tool(async (args) => {
      const input = createCustomFieldSchema.parse(args);
      return core.fields.createCustomField(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "update_custom_field",
    "Update a custom-field definition (label, type, options, required, aiExtractable…)",
    { ...updateCustomFieldSchema.shape, fieldId: uuid },
    tool(async (args) => {
      const { fieldId, ...patch } = updateCustomFieldSchema.extend({ fieldId: uuid }).parse(args);
      if (!fieldId) throw new Error("fieldId required");
      return core.fields.updateCustomField(core.ctx, requireSession(), fieldId, patch);
    }),
  );

  server.tool(
    "delete_custom_field",
    "Delete a custom-field definition (stored values remain but stop resolving)",
    { fieldId: uuid },
    tool(async ({ fieldId }) => {
      await core.fields.deleteCustomField(core.ctx, requireSession(), fieldId);
      return { ok: true };
    }),
  );

  server.tool(
    "set_field_values",
    "Batch-set custom field values on a deal or company (keyed by field key)",
    {
      entityType: z.enum(["deal", "company"]),
      entityId: uuid,
      values: z.record(z.string(), fieldValue.nullable()),
    },
    tool(async (args) => {
      const { entityType, entityId, values } = args;
      await core.db.transaction(async (tx) =>
        core.fields.setFieldValues(core.ctx, tx, requireSession(), entityType, entityId, values),
      );
      return { ok: true, updated: Object.keys(values).length };
    }),
  );

  /* ───────────────────── documents ───────────────────── */

  server.tool(
    "list_documents",
    "List documents for a company or deal with parse status",
    { companyId: uuid.optional(), dealId: uuid.optional() },
    tool(async (args) =>
      core.documents.listDocuments(core.ctx, requireSession(), args as never),
    ),
  );

  server.tool(
    "upload_document",
    "Upload a document (PDF preferred). Provide base64 content; it is stored, parsed and AI-extracted automatically.",
    {
      name: z.string().min(1),
      contentBase64: z.string().min(1),
      mime: z.string().default("application/pdf"),
      companyId: uuid.optional(),
      dealId: uuid.optional(),
    },
    tool(async (args) => {
      const doc = await core.documents.uploadDocument(core.ctx, requireSession(), {
        name: args.name!,
        mime: args.mime ?? "application/pdf",
        content: Buffer.from(args.contentBase64!, "base64"),
        companyId: args.companyId,
        dealId: args.dealId,
        source: "upload",
      });
      await core.ctx.enqueue("parse-document", {
        workspaceId: requireSession().workspaceId,
        documentId: doc.id,
      });
      return { ...doc, note: "queued for parsing + AI extraction" };
    }),
  );

  server.tool(
    "add_document_link",
    "Queue a DocSend/Pitch/Drive link for conversion into a permanent PDF attached to a company/deal",
    {
      url: z.string().url(),
      companyName: z.string().optional(),
      companyId: uuid.optional(),
      dealId: uuid.optional(),
    },
    tool(async (args) =>
      core.documents.createDocumentFromLink(core.ctx, requireSession(), args as never),
    ),
  );

  server.tool(
    "get_document_download_url",
    "Temporary signed download URL for a parsed document",
    { documentId: uuid },
    tool(async ({ documentId }) =>
      core.documents.getDownloadUrl(core.ctx, requireSession(), documentId),
    ),
  );

  server.tool(
    "delete_document",
    "Delete a document permanently (also removes it from any vault)",
    { documentId: uuid },
    tool(async ({ documentId }) => {
      await core.documents.deleteDocument(core.ctx, requireSession(), documentId);
      return { ok: true };
    }),
  );

  /* ───────────────────── email ingestion ───────────────────── */

  server.tool(
    "ingest_email",
    "Ingest an inbound pitch/update email into the AI pipeline (dedupe by messageId). Returns immediately; processing is async.",
    { ...inboundEmailPayload.shape },
    tool(async (args) => {
      const payload = inboundEmailPayload.parse(args);
      return core.emails.ingestEmail(core.ctx, requireSession().workspaceId, payload);
    }),
  );

  server.tool(
    "list_emails",
    "List ingested emails with processing status (queued|processing|processed|needs_review|failed)",
    {
      status: z.enum(["queued", "processing", "processed", "needs_review", "failed"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    tool(async (args) => core.emails.listEmails(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "get_email",
    "Full email content plus what the AI did with it (matched/created companies, updates)",
    { emailId: uuid },
    tool(async ({ emailId }) => core.emails.getEmail(core.ctx, requireSession(), emailId)),
  );

  server.tool(
    "reprocess_email",
    "Re-run AI processing for a failed/stuck email",
    { emailId: uuid },
    tool(async ({ emailId }) => {
      await core.emails.reprocessEmail(core.ctx, requireSession(), emailId);
      return { ok: true };
    }),
  );

  /* ───────────────────── notes, activity, portfolio ───────────────────── */

  server.tool(
    "add_note",
    "Attach a note to a deal and/or company",
    { body: z.string().min(1), companyId: uuid.optional(), dealId: uuid.optional() },
    tool(async (args) => core.content.addNote(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "list_notes",
    "Notes for a company or deal",
    { companyId: uuid.optional(), dealId: uuid.optional() },
    tool(async (args) => core.content.listNotes(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "delete_note",
    "Delete a note permanently",
    { noteId: uuid },
    tool(async ({ noteId }) => {
      await core.content.deleteNote(core.ctx, requireSession(), noteId);
      return { ok: true };
    }),
  );

  server.tool(
    "list_activity",
    "Audit trail / timeline. Scope by entity, company or deal; newest first.",
    {
      entityType: z.string().optional(),
      entityId: uuid.optional(),
      companyId: uuid.optional(),
      dealId: uuid.optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    tool(async (args) => core.content.listActivity(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "list_portfolio_updates",
    "Portfolio company update timeline (milestones, metrics, hiring…)",
    {
      companyId: uuid.optional(),
      kind: z.enum(["milestone", "metric", "hiring", "funding", "news", "update"]).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    },
    tool(async (args) => core.content.listPortfolioUpdates(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "add_portfolio_update",
    "Log a portfolio company update manually",
    {
      companyId: uuid,
      title: z.string().min(1),
      body: z.string().optional(),
      kind: z.enum(["milestone", "metric", "hiring", "funding", "news", "update"]).default("update"),
    },
    tool(async (args) => core.content.createPortfolioUpdate(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "generate_thesis",
    "Draft an AI investment memo (thesis) for a company; spends 1 credit. Returns markdown.",
    { companyId: uuid },
    tool(async ({ companyId }) =>
      core.intelligence.generateThesis(core.ctx, requireSession(), companyId),
    ),
  );

  server.tool(
    "capture_page",
    "Capture a webpage into the CRM (what the browser extension calls): creates/links company from domain, opens a deal, preserves the page permanently",
    {
      url: z.string().url(),
      title: z.string().optional(),
      note: z.string().optional(),
      screenshotBase64: z.string().optional(),
      createDeal: z.boolean().default(true),
    },
    tool(async (args) => core.intelligence.capturePage(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "export_deals",
    "Export all deals with custom fields as CSV or JSON (privacy-grade data portability)",
    { format: z.enum(["csv", "json"]).default("json") },
    tool(async ({ format }) => core.intelligence.exportDeals(core.ctx, requireSession(), format)),
  );

  server.tool(
    "list_workflows",
    "List automations (event triggers + conditions + actions) with run counts",
    {},
    tool(async () => core.automation.listWorkflows(core.ctx, requireSession())),
  );

  server.tool(
    "create_workflow",
    "Create an automation: WHEN <triggerEvent> IF <conditions> THEN <actions>. Actions may dispatch codified agents (run_agent with config {agentName}) — e.g. WHEN deal.stage_changed IF deal.stageName contains 'Due Diligence' THEN run_agent 'Diligence Checklist Builder'. Trigger agent_run.completed reacts to finished agents; conditions gate on output.* (e.g. output.recommendation eq advance).",
    {
      name: z.string().min(1),
      triggerEvent: z.enum([
        "company.created", "company.updated", "deal.created", "deal.stage_changed",
        "deal.updated", "email.processed", "email.needs_review", "document.parsed",
        "extraction.completed", "note.added", "portfolio_update.created",
        "agent_run.completed",
      ]),
      conditions: z.array(z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "contains", "exists"]),
        value: z.unknown().optional(),
      })).default([]),
      actions: z.array(z.object({
        type: z.enum(["add_note", "move_deal", "set_deal_fields", "set_company_fields", "create_portfolio_update", "run_agent"]),
        config: z.record(z.string(), z.unknown()).default({}),
      })).min(1),
      isEnabled: z.boolean().default(true),
    },
    tool(async (args) =>
      core.automation.createWorkflow(core.ctx, requireSession(), args as never),
    ),
  );

  server.tool(
    "test_workflow",
    "Dry-run an automation against the most recent real event of its trigger type — no side effects",
    { workflowId: uuid },
    tool(async ({ workflowId }) =>
      core.automation.testWorkflow(core.ctx, requireSession(), workflowId!),
    ),
  );

  server.tool(
    "get_workflow",
    "One automation: trigger, conditions, actions, run stats",
    { workflowId: uuid },
    tool(async ({ workflowId }) =>
      core.automation.getWorkflow(core.ctx, requireSession(), workflowId),
    ),
  );

  server.tool(
    "update_workflow",
    "Patch an automation (name, triggerEvent, conditions, actions, isEnabled)",
    { ...updateWorkflowSchema.shape, workflowId: uuid },
    tool(async (args) => {
      const { workflowId, ...patch } = updateWorkflowSchema.extend({ workflowId: uuid }).parse(args);
      if (!workflowId) throw new Error("workflowId required");
      return core.automation.updateWorkflow(core.ctx, requireSession(), workflowId, patch as never);
    }),
  );

  server.tool(
    "delete_workflow",
    "Delete an automation permanently (run history is kept)",
    { workflowId: uuid },
    tool(async ({ workflowId }) => {
      await core.automation.deleteWorkflow(core.ctx, requireSession(), workflowId);
      return { ok: true };
    }),
  );

  server.tool(
    "automations_overview",
    "Unified view of codified agents + event workflows with health stats — the control panel for everything that runs without you",
    {},
    tool(async () => core.automations.overview(core.ctx, requireSession())),
  );

  server.tool(
    "list_workflow_runs",
    "Recent automation runs with per-step results",
    { workflowId: uuid.optional(), limit: z.number().int().min(1).max(200).default(50) },
    tool(async (args) => core.automation.listRuns(core.ctx, requireSession(), args as never)),
  );

  server.tool(
    "create_webhook_subscription",
    "Subscribe an HTTPS endpoint to workspace events. Payloads are HMAC-SHA256 signed (X-Copyr-Signature); secret shown once.",
    {
      url: z.string().url(),
      events: z.array(z.string()).min(1).default(["*"]),
      description: z.string().optional(),
    },
    tool(async (args) =>
      core.outbound.createWebhookSubscription(core.ctx, requireSession(), args as never),
    ),
  );

  server.tool(
    "list_webhook_subscriptions",
    "All outbound webhook subscriptions with health stats",
    {},
    tool(async () => core.outbound.listWebhookSubscriptions(core.ctx, requireSession())),
  );

  server.tool(
    "list_webhook_deliveries",
    "Delivery log for a subscription: status, response codes, attempts",
    { subscriptionId: uuid },
    tool(async ({ subscriptionId }) =>
      core.outbound.listDeliveries(core.ctx, requireSession(), subscriptionId),
    ),
  );

  server.tool(
    "update_webhook_subscription",
    "Patch a webhook subscription (url, events, description, isActive)",
    { ...updateWebhookSubscriptionSchema.shape, subscriptionId: uuid },
    tool(async (args) => {
      const { subscriptionId, ...patch } = updateWebhookSubscriptionSchema
        .extend({ subscriptionId: uuid })
        .parse(args);
      if (!subscriptionId) throw new Error("subscriptionId required");
      return core.outbound.updateWebhookSubscription(
        core.ctx,
        requireSession(),
        subscriptionId,
        patch as never,
      );
    }),
  );

  server.tool(
    "delete_webhook_subscription",
    "Delete a webhook subscription permanently",
    { subscriptionId: uuid },
    tool(async ({ subscriptionId }) => {
      await core.outbound.deleteWebhookSubscription(core.ctx, requireSession(), subscriptionId);
      return { ok: true };
    }),
  );

  /* ───────────────────── analytics & search ───────────────────── */

  server.tool(
    "analytics_overview",
    "Firm KPIs: active deals, pipeline $, new founders, conversion rate, stage breakdown, weekly ingestion trend",
    {},
    tool(async () => core.analytics.analyticsOverview(core.ctx, requireSession())),
  );

  server.tool(
    "search",
    "Global search across companies and deals",
    { ...globalSearchQuerySchema.shape },
    tool(async (args) => {
      const q = globalSearchQuerySchema.parse(args);
      return core.analytics.globalSearch(core.ctx, requireSession(), q.q, q.limit);
    }),
  );

  /* ───────────────────── sharing ───────────────────── */

  server.tool(
    "create_share_link",
    "Create a public, trackable share link for a company (select which custom fields to expose; optional password/expiry)",
    { ...createShareLinkSchema.shape },
    tool(async (args) => {
      const input = createShareLinkSchema.parse(args);
      return core.sharing.createShareLink(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "list_share_links",
    "All share links with view counts",
    {},
    tool(async () => core.sharing.listShareLinks(core.ctx, requireSession())),
  );

  server.tool(
    "list_share_views",
    "Access log for a share link (who/when viewed)",
    { linkId: uuid },
    tool(async ({ linkId }) => core.sharing.listShareViews(core.ctx, requireSession(), linkId!)),
  );

  server.tool(
    "update_share_link",
    "Patch a share link: title, exposed attributes, documents toggle, password (null removes), expiry, or revoked=true to kill it",
    { ...updateShareLinkSchema.shape, linkId: uuid },
    tool(async (args) => {
      const { linkId, ...patch } = updateShareLinkSchema.extend({ linkId: uuid }).parse(args);
      if (!linkId) throw new Error("linkId required");
      return core.sharing.updateShareLink(core.ctx, requireSession(), linkId, patch);
    }),
  );

  server.tool(
    "delete_share_link",
    "Delete a share link permanently",
    { linkId: uuid },
    tool(async ({ linkId }) => {
      await core.sharing.deleteShareLink(core.ctx, requireSession(), linkId);
      return { ok: true };
    }),
  );

  /* ───────────────────── diligence vaults & review tables ───────────────────── */

  server.tool(
    "list_vaults",
    "List diligence vaults with document/parse/table counts",
    {},
    tool(async () => core.vaults.listVaults(core.ctx, requireSession())),
  );

  server.tool(
    "create_vault",
    "Create a diligence vault — bulk-review container for a company/deal data room",
    { ...createVaultSchema.shape },
    tool(async (args) => {
      const input = createVaultSchema.parse(args);
      return core.vaults.createVault(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "get_vault",
    "Vault detail: documents with parse status + review tables",
    { vaultId: uuid },
    tool(async ({ vaultId }) => core.vaults.getVaultDetail(core.ctx, requireSession(), vaultId)),
  );

  server.tool(
    "add_documents_to_vault",
    "Attach existing documentIds to a vault and/or upload new ones (base64). New uploads are queued for parsing.",
    {
      vaultId: uuid,
      documentIds: z.array(uuid).optional(),
      upload: z
        .array(z.object({ name: z.string().min(1), mime: z.string().optional(), contentBase64: z.string() }))
        .optional(),
    },
    tool(async (args) =>
      core.vaults.addDocumentsToVault(core.ctx, requireSession(), args.vaultId!, {
        documentIds: args.documentIds,
        upload: args.upload,
      }),
    ),
  );

  server.tool(
    "remove_document_from_vault",
    "Detach a document from a vault (document itself is kept)",
    { vaultId: uuid, documentId: uuid },
    tool(async ({ vaultId, documentId }) => {
      await core.vaults.removeDocumentFromVault(core.ctx, requireSession(), vaultId, documentId);
      return { ok: true };
    }),
  );

  server.tool(
    "update_vault",
    "Rename a vault, edit its description, or archive/reactivate it",
    { ...updateVaultSchema.shape, vaultId: uuid },
    tool(async (args) => {
      const { vaultId, ...patch } = updateVaultSchema.extend({ vaultId: uuid }).parse(args);
      if (!vaultId) throw new Error("vaultId required");
      return core.vaults.updateVault(core.ctx, requireSession(), vaultId, patch);
    }),
  );

  server.tool(
    "delete_vault",
    "Delete a diligence vault permanently (documents are kept; review tables go with it)",
    { vaultId: uuid },
    tool(async ({ vaultId }) => {
      await core.vaults.deleteVault(core.ctx, requireSession(), vaultId);
      return { ok: true };
    }),
  );

  server.tool(
    "create_review_table",
    "Run ONE structured extraction query across EVERY parsed document in a vault. Define columns (key/label/type/description); rows come back per-document with citation quotes. Async by default; poll get_review_table until status=completed.",
    {
      vaultId: uuid,
      name: z.string().min(1),
      instruction: z.string().optional(),
      columns: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          type: z.enum(["text", "number", "currency", "date", "boolean"]).default("text"),
          description: z.string().optional(),
        }),
      ).min(1).max(20),
      waitForCompletion: z.boolean().default(false),
    },
    tool(async (args) => {
      const input = createReviewTableSchema.parse(args);
      return core.vaults.createReviewTable(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "get_review_table",
    "Review table definition + extracted rows (data values + supporting quotes per document)",
    { reviewTableId: uuid },
    tool(async ({ reviewTableId }) => core.vaults.getReviewTable(core.ctx, requireSession(), reviewTableId)),
  );

  /* ───────────────────── grounded research (Knowledge) ───────────────────── */

  server.tool(
    "ask_knowledge",
    "Answer a question grounded ONLY in workspace material (parsed docs, notes, portfolio updates, emails, fund memories) with citations. Scope by companyId/dealId/vaultId. Persists as a report.",
    {
      question: z.string().min(3),
      companyId: uuid.optional(),
      dealId: uuid.optional(),
      vaultId: uuid.optional(),
      includeFirmContext: z.boolean().default(true),
    },
    tool(async (args) => {
      const input = askResearchSchema.parse(args);
      return core.research.ask(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "list_research_reports",
    "Past research reports with citations; filter by companyId",
    {
      companyId: uuid.optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    tool(async ({ companyId, limit, offset }) =>
      core.research.listReports(core.ctx, requireSession(), { companyId, limit, offset }),
    ),
  );

  server.tool(
    "get_research_report",
    "One research report: question, cited answer, confidence",
    { reportId: uuid },
    tool(async ({ reportId }) => core.research.getReport(core.ctx, requireSession(), reportId)),
  );

  /* ───────────────────── codified agents (Thesis Builder) ───────────────────── */

  server.tool(
    "list_agents",
    "Codified fund agents (thesis_screen / diligence_checklist / portfolio_monitor / custom)",
    {},
    tool(async () => core.agents.listAgents(core.ctx, requireSession())),
  );

  server.tool(
    "get_agent",
    "Agent definition incl. instructions and config knobs",
    { agentId: uuid },
    tool(async ({ agentId }) => core.agents.getAgent(core.ctx, requireSession(), agentId)),
  );

  server.tool(
    "create_agent",
    "Codify expertise into an agent: thesis text/instructions + keyword knobs (+ optional checklist items or schedule cron).",
    { ...createAgentSchema.shape },
    tool(async (args) => {
      const input = createAgentSchema.parse(args);
      return core.agents.createAgent(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "update_agent",
    "Update agent instructions/config/schedule/active state — every change bumps the version.",
    { ...updateAgentSchema.shape, agentId: uuid },
    tool(async (args) => {
      const { agentId, ...patch } = updateAgentSchema.extend({ agentId: uuid }).parse(args);
      if (!agentId) throw new Error("agentId required");
      return core.agents.updateAgent(core.ctx, requireSession(), agentId, patch);
    }),
  );

  server.tool(
    "run_agent",
    "Execute an agent end-to-end against a scope (companyId/dealId/spaceId). Returns queued run; poll get_agent_run for output. thesis_screen returns fitScore/recommendation/reasons/concerns and writes a screening note.",
    { ...runAgentSchema.shape, agentId: uuid },
    tool(async (args) => {
      const { agentId, ...input } = runAgentSchema.extend({ agentId: uuid }).parse(args);
      if (!agentId) throw new Error("agentId required");
      return core.agents.queueAgentRun(core.ctx, requireSession(), agentId, input);
    }),
  );

  server.tool(
    "get_agent_run",
    "Run status, step log, structured output (fit score, checklist tasks created, monitoring summary…)",
    { runId: uuid },
    tool(async ({ runId }) => core.agents.getRun(core.ctx, requireSession().workspaceId, runId)),
  );

  server.tool(
    "list_agent_runs",
    "Recent runs across agents; filter by agentId/status",
    {
      agentId: uuid.optional(),
      status: z.enum(["queued", "running", "completed", "failed"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    tool(async (args) =>
      core.agents.listRuns(core.ctx, requireSession(), { ...args, limit: args.limit ?? 50 }),
    ),
  );

  /* ───────────────────── spaces & tasks ───────────────────── */

  server.tool(
    "list_spaces",
    "Deal spaces: context containers binding company/deal/vault/tasks/participants",
    {},
    tool(async () => core.spaces.listSpaces(core.ctx, requireSession())),
  );

  server.tool(
    "list_tasks",
    "Query tasks across spaces; filter by spaceId/status (todo|doing|done)",
    {
      spaceId: uuid.optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    tool(async ({ spaceId, status, limit }) =>
      core.spaces.listTasks(core.ctx, requireSession(), { spaceId, status, limit }),
    ),
  );

  server.tool(
    "get_space",
    "FULL space context bundle — company, deals, documents, notes, portfolio updates, tasks, participants, recent activity. Open here; never start work from scratch.",
    { spaceId: uuid },
    tool(async ({ spaceId }) => core.spaces.getSpace(core.ctx, requireSession(), spaceId)),
  );

  server.tool(
    "create_space",
    "Open a deal space (auto-provisions standard diligence tasks; optionally link company/deal).",
    { ...createSpaceSchema.shape },
    tool(async (args) => {
      const input = createSpaceSchema.parse(args);
      return core.spaces.createSpace(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "create_task",
    "Create a task in a space. Assign to a teammate (assigneeUserId) OR route it to a codified agent (assigneeAgentId) which executes immediately.",
    { ...createTaskSchema.shape },
    tool(async (args) => {
      const input = createTaskSchema.parse(args);
      return core.spaces.createTask(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "update_task",
    "Update task status/details/assignee (status=done completes it)",
    { ...updateTaskSchema.shape, taskId: uuid },
    tool(async (args) => {
      const { taskId, ...patch } = updateTaskSchema.extend({ taskId: uuid }).parse(args);
      if (!taskId) throw new Error("taskId required");
      return core.spaces.updateTask(core.ctx, requireSession(), taskId, patch);
    }),
  );

  server.tool(
    "add_space_participant",
    "Invite an external party (co-investor, founder, advisor) to a shared space",
    { spaceId: uuid, email: z.string().email(), name: z.string().optional(), org: z.string().optional(), role: z.enum(["viewer", "editor"]).default("viewer") },
    tool(async (args) =>
      core.spaces.addParticipant(core.ctx, requireSession(), args.spaceId!, {
        email: args.email!,
        name: args.name,
        org: args.org,
        role: args.role,
      }),
    ),
  );

  /* ───────────────────── memory ───────────────────── */

  server.tool(
    "remember",
    "Store a durable preference/fact/process for the fund (userId omitted = fund-wide). Memory scopes every future AI answer and screen.",
    { ...createMemorySchema.shape },
    tool(async (args) => {
      const input = createMemorySchema.parse(args);
      return core.memory.remember(core.ctx, requireSession(), input);
    }),
  );

  server.tool(
    "recall_memories",
    "Inspect stored memories (kind filter; pinned/heaviest first)",
    { kind: z.enum(["preference", "focus_area", "process", "fact"]).optional(), limit: z.number().int().min(1).max(200).default(50) },
    tool(async (args) => ({
      items: await core.memory.listMemories(core.ctx, requireSession(), { kind: args.kind, limit: args.limit }),
    })),
  );

  server.tool(
    "forget_memory",
    "Delete one memory permanently",
    { memoryId: uuid },
    tool(async ({ memoryId }) => {
      await core.memory.forget(core.ctx, requireSession(), memoryId);
      return { ok: true };
    }),
  );

  server.tool(
    "remember_learned",
    "Capture something learned from an interaction as a fund memory — dedupes against previously learned items (unlike remember, which always creates)",
    {
      content: z.string().min(1),
      kind: z.enum(["preference", "focus_area", "process", "fact"]).optional(),
    },
    tool(async ({ content, kind }) =>
      core.memory.learn(core.ctx, requireSession().workspaceId, { content, kind }),
    ),
  );

  /* ───────────────────── command center ───────────────────── */

  server.tool(
    "command_center_overview",
    "Deployment intelligence: adoption across surfaces, AI-vs-human activity split, credit economics, anonymized peer benchmarks (percentiles), prioritized recommendations",
    {},
    tool(async () => core.commandCenter.commandCenter(core.ctx, requireSession())),
  );

  /* ───────────────────── central assistant ───────────────────── */

  server.tool(
    "list_conversations",
    "Assistant chat thread history (reviewable History surface)",
    {},
    tool(async () => core.assistant.listConversations(core.ctx, requireSession())),
  );

  server.tool(
    "get_conversation",
    "One assistant thread with every message and tool step",
    { conversationId: uuid },
    tool(async ({ conversationId }) =>
      core.assistant.getConversation(core.ctx, requireSession(), conversationId),
    ),
  );

  server.tool(
    "delete_conversation",
    "Delete an assistant chat thread permanently",
    { conversationId: uuid },
    tool(async ({ conversationId }) => {
      await core.assistant.deleteConversation(core.ctx, requireSession(), conversationId);
      return { ok: true };
    }),
  );

  server.tool(
    "send_assistant_message",
    "Send a message to the central Assistant — it can call any product tool (pipeline, vaults, research, agents, memory) and replies with cited, review-ready output. Omit conversationId to start a new thread.",
    {
      content: z.string().min(1),
      conversationId: uuid.nullable().optional(),
    },
    tool(async (args) => {
      const input = sendMessageSchema.parse({ content: args.content });
      return core.assistant.sendMessage(
        core.ctx,
        requireSession(),
        args.conversationId ?? null,
        input.content,
      );
    }),
  );

  /* ───────────────────── resources ───────────────────── */

  const jsonContents = (uri: URL, data: unknown) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
  });

  server.resource(
    "deal",
    new ResourceTemplate("copyr://deals/{id}", {
      list: async () => {
        const { items } = await core.deals.listDeals(
          core.ctx,
          requireSession(),
          listDealsQuerySchema.parse({ limit: 50 }),
        );
        return {
          resources: items.map((d) => ({
            uri: `copyr://deals/${d.id}`,
            name: `${d.company.name} — ${d.title}`,
            description: d.roundStage ?? undefined,
            mimeType: "application/json",
          })),
        };
      },
    }),
    async (uri, { id }) => jsonContents(uri, await core.deals.getDeal(core.ctx, requireSession(), id as string)),
  );

  server.resource(
    "company",
    new ResourceTemplate("copyr://companies/{id}", {
      list: async () => {
        const { items } = await core.companies.listCompanies(core.ctx, requireSession(), {});
        return {
          resources: items.map((c) => ({
            uri: `copyr://companies/${c.id}`,
            name: c.name,
            description: c.description ?? undefined,
            mimeType: "application/json",
          })),
        };
      },
    }),
    async (uri, { id }) =>
      jsonContents(uri, await core.companies.getCompany(core.ctx, requireSession(), id as string)),
  );

  server.resource(
    "vault",
    new ResourceTemplate("copyr://vaults/{id}", {
      list: async () => {
        const vaults = await core.vaults.listVaults(core.ctx, requireSession());
        return {
          resources: vaults.map((v) => ({
            uri: `copyr://vaults/${v.id}`,
            name: v.name,
            mimeType: "application/json",
          })),
        };
      },
    }),
    async (uri, { id }) =>
      jsonContents(uri, await core.vaults.getVaultDetail(core.ctx, requireSession(), id as string)),
  );

  server.resource(
    "space",
    new ResourceTemplate("copyr://spaces/{id}", {
      list: async () => {
        const spaces = await core.spaces.listSpaces(core.ctx, requireSession());
        return {
          resources: spaces.map((sp) => ({
            uri: `copyr://spaces/${sp.id}`,
            name: sp.name,
            mimeType: "application/json",
          })),
        };
      },
    }),
    async (uri, { id }) =>
      jsonContents(uri, await core.spaces.getSpace(core.ctx, requireSession(), id as string)),
  );

  server.resource(
    "agent",
    new ResourceTemplate("copyr://agents/{id}", {
      list: async () => {
        const agents = await core.agents.listAgents(core.ctx, requireSession());
        return {
          resources: agents.map((a) => ({
            uri: `copyr://agents/${a.id}`,
            name: a.name,
            description: a.kind,
            mimeType: "application/json",
          })),
        };
      },
    }),
    async (uri, { id }) =>
      jsonContents(uri, await core.agents.getAgent(core.ctx, requireSession(), id as string)),
  );

  server.resource(
    "research-report",
    new ResourceTemplate("copyr://research/{id}", {
      list: async () => {
        const { items } = await core.research.listReports(core.ctx, requireSession(), { limit: 50 });
        return {
          resources: items.map((r) => ({
            uri: `copyr://research/${r.id}`,
            name: r.question,
            mimeType: "application/json",
          })),
        };
      },
    }),
    async (uri, { id }) =>
      jsonContents(uri, await core.research.getReport(core.ctx, requireSession(), id as string)),
  );

  server.resource("workspace-info", "copyr://workspace/info", async (uri) =>
    jsonContents(uri, await core.session.getWorkspace(core.ctx, requireSession().workspaceId)),
  );

  server.resource("workspace-pipelines", "copyr://workspace/pipelines", async (uri) =>
    jsonContents(uri, await core.pipelines.listPipelines(core.ctx, requireSession())),
  );

  server.resource("workspace-custom-fields", "copyr://workspace/custom-fields", async (uri) =>
    jsonContents(uri, await core.fields.listCustomFields(core.ctx, requireSession())),
  );

  server.resource("workspace-tasks", "copyr://workspace/tasks", async (uri) =>
    jsonContents(uri, await core.spaces.listTasks(core.ctx, requireSession(), {})),
  );

  server.resource("workspace-agents", "copyr://workspace/automations", async (uri) =>
    jsonContents(uri, await core.automations.overview(core.ctx, requireSession())),
  );

  /* ───────────────────── prompts ───────────────────── */

  server.prompt(
    "triage-inbox",
    "Process all queued inbox emails end-to-end",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Triage the VentureLabs inbox:\n" +
              "1. list_emails(status=queued)\n" +
              "2. For each: get_email and review the AI result (companies matched/created).\n" +
              "3. If status=needs_review, inspect why (often credits exhausted or ambiguous sender) and reprocess after fixing.\n" +
              "4. For each affected deal, ensure title/roundStage make sense; fix with update_deal.\n" +
              "5. add_note summarizing your triage on any deal that looks hot (ask > $5M).\n" +
              "Finish with a one-paragraph summary of processed volume and notable pitches.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "weekly-pipeline-review",
    "Draft a weekly pipeline review",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Prepare this week's pipeline review:\n" +
              "1. analytics_overview for KPIs vs last period.\n" +
              "2. list_deals sorted by updated_at ascending — flag stale deals (>14 days without activity).\n" +
              "3. list_portfolio_updates for the week's portco highlights.\n" +
              "4. Output: KPI table, stale-deal watchlist with suggested next steps, portco highlights, and three recommended actions.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "run-diligence",
    "Bulk-review a data room in a vault and synthesize findings",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Run structured diligence over a vault:\n" +
              "1. list_vaults and pick the target (or create_vault + add_documents_to_vault if needed).\n" +
              "2. get_vault and confirm documents are parsed; wait/re-poll for pending ones.\n" +
              "3. create_review_table with columns for what matters (e.g. counterparty, term, value, change_of_control, renewal_date, risk_notes).\n" +
              "4. Poll get_review_table until completed. Work through the EXCEPTIONS — rows with nulls or low confidence.\n" +
              "5. ask_knowledge to synthesize the top three risks across the corpus, citing sources.\n" +
              "6. Summarize: table of extracted terms, exceptions needing human review, cited risk synthesis.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "portfolio-monitor",
    "Standing portfolio coverage sweep",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Run the portfolio monitor:\n" +
              "1. list_agents and find the portfolio_monitor agent (create one via create_agent(kind=portfolio_monitor) with watchItems if missing).\n" +
              "2. run_agent without a company scope so it sweeps the whole portfolio.\n" +
              "3. get_agent_run and read highlights + quietCompanies.\n" +
              "4. For quiet companies (>45 days), check get_company and list_activity for context, then add_note proposing an outreach angle.\n" +
              "5. Finish with a one-screen briefing: events of the fortnight, companies needing attention, suggested actions.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "build-automation",
    "Author an agent or event automation from a plain-language description",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Help me build an automation from a description.\n" +
              "1. Ask what should happen (or infer from the user's message). Decide: is this JUDGMENT (needs AI reasoning — use create_agent) or REACTION (deterministic when/event — use create_workflow)?\n" +
              "2. For agents: pick kind (thesis_screen | diligence_checklist | portfolio_monitor), write sharp instructions, set keyword knobs.\n" +
              "3. For workflows: pick triggerEvent, write conditions on snapshot paths (deal.askAmount, company.sector, output.recommendation…), choose actions. Use run_agent to dispatch judgment mid-flow.\n" +
              "4. Create it, then test_workflow if applicable. Present the result as WHEN/IF/THEN and explain how it will behave.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "company-deep-dive",
    "Full diligence brief on one company from every angle",
    { companyId: z.string().uuid() },
    ({ companyId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Build a complete deep-dive brief on company ${companyId}:\n` +
              "1. get_company (custom fields included) and list_contacts for the people.\n" +
              "2. list_deals + list_notes + list_activity for our history with them; list_documents for their materials.\n" +
              "3. list_portfolio_updates for traction signals.\n" +
              "4. ask_knowledge scoped to the company: 'What does this company do, what stage is it at, and what are the top three risks?'\n" +
              "5. If an agent of kind thesis_screen exists, run_agent against this company for a fit score.\n" +
              "Deliver a one-page brief: what they do, team, round/ask, our interactions, traction, risks, fit score, recommended next step.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "quarterly-portfolio-review",
    "Quarterly portfolio health review across all portcos",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Run the quarterly portfolio review:\n" +
              "1. search_companies(status=portfolio) for the full roster.\n" +
              "2. list_portfolio_updates(limit=200) — bucket highlights by kind (milestone/metric/hiring/funding).\n" +
              "3. analytics_overview for pipeline-side context.\n" +
              "4. command_center_overview for adoption + benchmarking color.\n" +
              "5. Output: portfolio scorecard table, quarter's wins by company, watch-list (quiet companies, metric misses), and five focus recommendations for next quarter.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "onboard-workspace",
    "Set up a fresh workspace: pipeline, fields, agents, automations",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Set up this VentureLabs workspace end-to-end:\n" +
              "1. get_workspace_info and list_pipelines to see what exists already — never duplicate.\n" +
              "2. Ask the user about their fund thesis, check size and stage focus; remember the answers (remember, kind=focus_area/preference).\n" +
              "3. Shape the pipeline: create_stage/update_stage to match their process; list_custom_fields then create_custom_field for what they track (check size, lead partner, conviction…).\n" +
              "4. Codify judgment: create_agent for a thesis screen matching their stated criteria.\n" +
              "5. Wire reactions: create_workflow for e.g. email.needs_review → add_note, or deal.stage_changed into DD → run_agent checklist builder. Test each with test_workflow.\n" +
              "6. Optionally create_intake_form so founders can pitch via the website.\n" +
              "7. Summarize everything configured as a checklist with links/ids.",
          },
        },
      ],
    }),
  );

  return server;
}

export type { Session };
