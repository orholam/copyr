/**
 * Curated OpenAPI 3.1 description of the Copyr REST surface.
 *
 * Route handlers validate with zod at runtime; this document is the
 * machine-readable companion for agents and integrations (kept in sync
 * manually — the path list below mirrors apps/api/src/routes/*).
 */


type Method = "get" | "post" | "patch" | "put" | "delete";
interface PathSpec {
  tag: string;
  summary: string;
  methods: Partial<Record<Method, true>>;
  body?: string;
  query?: Array<[string, string]>;
  params?: Array<[string, string]>;
}

const P = (
  tag: string,
  summary: string,
  methods: PathSpec["methods"],
  extra: Partial<PathSpec> = {},
): PathSpec => ({ tag, summary, methods, ...extra });

const PATHS: Record<string, PathSpec> = {
  "/me": P("workspace", "Current workspace, members and actor", { get: true }),
  "/me/permissions": P("workspace", "Caller's effective permission set", { get: true }),
  "/me/notification-prefs": P("workspace", "Get or replace per-member notification preferences", { get: true, put: true }),
  "/credits": P("credits", "AI credit balance + recent ledger", { get: true }),
  "/credits/purchase": P("credits", "Buy a credit top-up pack", { post: true }, { body: "CreditPurchase" }),
  "/pipelines": P("pipeline", "Pipelines with ordered stages", { get: true }),
  "/stages": P("pipeline", "Create a stage", { post: true }),
  "/stages/{id}": P("pipeline", "Update or delete a stage", { patch: true, delete: true }),
  "/custom-fields": P("fields", "List / create custom fields", { get: true, post: true }),
  "/custom-fields/{id}": P("fields", "Update or delete a custom field", { patch: true, delete: true }),
  "/companies": P("companies", "Search companies (q, status, sector, tag)", { get: true, post: true }),
  "/companies/{id}": P("companies", "Get / update / delete a company", { get: true, patch: true, delete: true }),
  "/companies/{id}/contacts": P("companies", "Company contacts", { get: true }),
  "/companies/{id}/relationships": P("companies", "Team ↔ contact interaction graph", { get: true }),
  "/companies/{id}/thesis": P("ai", "Generate an AI investment memo (spends credits)", { post: true }),
  "/companies/{id}/merge": P("companies", "Merge this company into another", { post: true }, { body: "MergeInput" }),
  "/deals": P("deals", "Query deals (stage, tags, owner, ask range, q …)", { get: true, post: true }),
  "/deals/{id}": P("deals", "Get / update a deal", { get: true, patch: true }),
  "/deals/{id}/move": P("deals", "Kanban move (stage + optional beforeDealId)", { post: true }),
  "/documents": P("documents", "List documents for a company/deal", { get: true }),
  "/documents/upload": P("documents", "Multipart PDF upload → parse+extract queue", { post: true }),
  "/documents/from-link": P("documents", "Convert a DocSend/Pitch link to permanent PDF", { post: true }),
  "/documents/{id}/download-url": P("documents", "Signed download URL", { get: true }),
  "/emails": P("inbox", "Inbound emails with processing status", { get: true }),
  "/emails/{id}": P("inbox", "Email detail incl. AI results", { get: true }),
  "/emails/{id}/reprocess": P("inbox", "Re-run AI processing", { post: true }),
  "/emails/simulate": P("inbox", "Fabricate an inbound pitch email (dev/demo)", { post: true }),
  "/capture": P("ingestion", "Capture any webpage into the CRM", { post: true }, { body: "CaptureInput" }),
  "/notes": P("activity", "Add / list notes (@mentions supported)", { get: true, post: true }),
  "/activity": P("activity", "Workspace audit trail", { get: true }),
  "/portfolio-updates": P("portfolio", "Portfolio update timeline", { get: true, post: true }),
  "/analytics/overview": P("analytics", "KPIs, stage breakdown, weekly trend", { get: true }),
  "/search": P("analytics", "Global search across companies & deals", { get: true }),
  "/workflows": P("automations", "List / create automations", { get: true, post: true }),
  "/workflows/{id}": P("automations", "Update / delete an automation", { patch: true, delete: true }),
  "/workflows/{id}/test": P("automations", "Dry-run against latest real event", { post: true }),
  "/workflow-runs": P("automations", "Automation run history", { get: true }),
  "/webhooks": P("webhooks", "Outbound webhook subscriptions", { get: true, post: true }),
  "/webhooks/{id}": P("webhooks", "Update / delete subscription", { patch: true, delete: true }),
  "/webhooks/{id}/deliveries": P("webhooks", "Delivery log (status, attempts)", { get: true }),
  "/views": P("views", "Saved pipeline views", { get: true, post: true }),
  "/views/{id}": P("views", "Delete a saved view", { delete: true }),
  "/share-links": P("sharing", "Create / list share links", { get: true, post: true }),
  "/share-links/{id}": P("sharing", "Update / revoke a share link", { patch: true, delete: true }),
  "/share-links/{id}/views": P("sharing", "Access log for a share link", { get: true }),
  "/public/share/{token}": P("public", "Public shared record (password-gated)", { get: true }),
  "/public/forms/{slug}": P("public", "Intake form definition / submission", { get: true, post: true }),
  "/api-keys": P("workspace", "Agent API keys", { get: true, post: true }),
  "/intake-forms": P("forms", "Intake forms", { get: true, post: true }),
};

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, spec] of Object.entries(PATHS)) {
    const key = `/api/v1${path}`;
    paths[key] = {};
    for (const method of ["get", "post", "patch", "delete"] as const) {
      if (!spec.methods[method]) continue;
      const op: Record<string, unknown> = {
        tags: [spec.tag],
        summary: spec.summary,
        responses: {
          "200": { description: "OK" },
          "401": { description: "Unauthorized" },
          "422": { description: "Validation error" },
        },
      };
      if (spec.params) {
        op.parameters = spec.params.map(([name, where]) => ({
          name,
          in: where,
          required: name === "id" || where === "path",
          schema: { type: "string" },
        }));
      }
      if (spec.body && method !== "get") {
        op.requestBody = {
          content: { "application/json": { schema: { $ref: `#/components/schemas/${spec.body}` } } },
        };
      }
      paths[key][method] = op;
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Copyr API",
      version: "1.0.0",
      description:
        "AI-native deal-flow CRM for venture capital. " +
        "Authenticate with Authorization: Bearer <Supabase access token> (humans) " +
        "or X-API-Key (agents). X-Workspace-Slug selects among a user's workspaces " +
        "when a JWT is present; slug-only auth is development-only. " +
        "All list endpoints accept limit/offset. Automations, ingestion and AI " +
        "endpoints consume workspace AI credits where noted.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "workspace" }, { name: "credits" }, { name: "pipeline" },
      { name: "fields" }, { name: "companies" }, { name: "deals" },
      { name: "documents" }, { name: "inbox" }, { name: "ingestion" },
      { name: "activity" }, { name: "portfolio" }, { name: "analytics" },
      { name: "automations" }, { name: "webhooks" }, { name: "views" },
      { name: "sharing" }, { name: "public" }, { name: "ai" }, { name: "forms" },
    ],
    components: {
      schemas: {
        CaptureInput: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
            title: { type: "string" },
            note: { type: "string" },
            screenshotBase64: { type: "string" },
            createDeal: { type: "boolean", default: true },
          },
        },
        MergeInput: {
          type: "object",
          required: ["intoCompanyId"],
          properties: { intoCompanyId: { type: "string", format: "uuid" } },
        },
        CreditPurchase: {
          type: "object",
          properties: { pack: { type: "string", enum: ["starter", "team", "scale"] } },
        },
      },
    },
    paths,
  };
}
