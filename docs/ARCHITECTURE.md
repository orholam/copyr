# Copyr — Architecture & Strategy

> Copyr is an AI-native, agent-first clone of [useroulette.com](https://useroulette.com)
> (AI-powered deal flow CRM for VC firms), rebuilt with a cleaner architecture where
> **every capability is exposed to AI agents via MCP** and the human UI is just
> another client of the same core.

## 1. Product scope (full Roulette parity)

| Area | Roulette feature | Copyr implementation |
|---|---|---|
| Deal ingestion | Paste DocSend/Pitch/Drive link → converted permanent PDF | `documents.from-link` + `convert-link` job (provider-abstracted; mock resolver locally) |
| Deal ingestion | Bulk PDF upload w/ auto-processing | Multipart upload → storage → parse job |
| Deal ingestion | Manual entry | Companies/Deals CRUD |
| Deal ingestion | Forward emails (single + bulk dumps, 100+ companies) | Inbound email webhook (SES-compatible payload) + `process-email` job |
| Deal ingestion | Website intake form | Public form endpoint `/api/v1/public/forms/:slug` + configurable forms |
| AI extraction | Read decks/emails → fill custom fields | Structured extraction (zod schema → JSON schema) via provider abstraction |
| Pipeline | Custom stages per workspace/pipeline | `pipelines` + `stages` tables, drag-and-drop ordering w/ fractional indexing |
| Pipeline | Custom attributes | `custom_fields` (text/number/currency/select/multi-select/date/url/checkbox) targeting deal or company |
| Views | Table view: sort/filter/search across all fields | Generic query engine over deals + field_values joins |
| Views | Kanban board | dnd-kit board, fractional-index positions, SSE live updates |
| Analytics | Active deals, pipeline $, new founders, conversion rate | `/analytics/overview` + trends from activity log |
| Inbox | AI inbox w/ statuses (queued/processing/processed) | `email_messages.processing_status`, live SSE updates |
| Portfolio | Portco update timelines from emails | `portfolio_updates` + classifier job |
| Relationships | Who on the team talked to which company | `relationships` derived from inbound/outbound email graph |
| Sharing | Share links: selective attrs, password, expiry, access logs, editable | `share_links` + `share_views`, public viewer page |
| Team | Workspaces, roles, collaboration | workspaces/memberships (Supabase Auth JWT → membership) |
| Credits | 500 AI credits/user/month | `credit_ledger` with grants + metered spends |
| API | Full API + Zapier | REST /api/v1 + OpenAPI + webhooks + **MCP server** (better than Zapier) |

## 2. Non-negotiable design principles

1. **Agent-first**: 100% of product capability lives in `packages/core`. Three thin
   shells consume it: REST API, MCP server, and the built-in copilot. If the UI can do it,
   an agent can do it through MCP.
2. **One write path**: every mutation emits a typed event into the `activities`
   table (actor = user | ai | system). The activity feed is the audit trail AND the
   realtime stream source (SSE).
3. **Contracts everywhere**: zod schemas in `@copyr/contracts` are the single source of
   truth for HTTP validation, DB row typing boundaries, LLM structured output, and MCP tool IO.
4. **Deterministic offline mode**: `AI_PROVIDER=mock` gives deterministic extraction so the
   entire system runs without network/API keys; swap to real LLMs by env only.
5. **AWS-shaped local dev**: Postgres (→RDS), MinIO (→S3), Mailpit webhook (→SES inbound),
   pg-boss on PG (no Redis needed), stateless apps (→ECS Fargate).

## 3. Monorepo layout

```
apps/
  api/     Fastify REST + SSE + webhooks (+ serves built SPA in prod)
  web/     React 19 + Vite SPA (marketing + app)
  mcp/     MCP server (stdio + Streamable HTTP at /mcp)
packages/
  config/      typed env (zod)
  db/          Drizzle schema/client/migrations/seed
  contracts/   zod DTOs, filters, events, tool IO
  storage/     S3-compatible object storage adapter
  ai/          provider registry, extractors, credit accounting
  core/        domain services + pg-boss job orchestration (the heart)
```

## 4. Data model (summary)

Core entities: `workspaces`, `users`, `memberships`, `pipelines`, `stages`,
`companies`, `deals`, `custom_fields`, `field_values`, `contacts`, `documents`,
`email_messages`, `activities`, `notes`, `extractions`, `portfolio_updates`,
`relationships`, `share_links`, `share_views`, `api_keys`, `credit_ledger`,
`intake_forms`.

Platform surfaces (Harvey-style operating layer):

- **Vaults**: `vaults`, `vault_documents`, `review_tables` (column specs),
  `review_rows` (extracted values + citation quotes + confidence; locked rows
  survive reruns). One query reviews every parsed doc in the vault.
- **Research**: `research_reports` — question, cited answer, scope, model, credits.
- **Agents**: `agents` (kind: thesis_screen | diligence_checklist |
  portfolio_monitor | custom; instructions + config knobs; schedule cron;
  versioned) and `agent_runs` (status, trigger, scoped input, structured output,
  step log).
- **Spaces**: `spaces`, `space_participants`, `tasks` (assignee = user OR agent;
  assigning to an agent dispatches its run and completes the task on finish).
- **Memory**: `memories` (fund-wide or per-user; declared vs learned; weighted).

Notable mechanics:
- Kanban order: fractional index strings (`position`) → O(1) reorders, no global renumbering.
- Polymorphic `field_values` keyed `(field_id, entity_type, entity_id)` value jsonb.
- `activities(entity_type, entity_id)` powers timeline + SSE + analytics trends.
- Idempotency: email ingestion dedupes on `(workspace_id, message_id)`; link conversion
  dedupes on normalized URL.

## 5. Jobs (pg-boss, same Postgres)

- `process-email`: normalize → detect companies (existing or new) → create/update deals →
  attach documents → spawn extraction → relationship graph update → portfolio classification
- `parse-document`: PDF text layer extraction (`unpdf`) → status transitions
- `convert-link`: DocSend/Pitch/etc → PDF (mock locally; Playwright/screenshot provider later)
- `run-extraction`: LLM structured extraction against workspace's custom fields + heuristics fallback
- `run-review-table`: one structured AI query across all parsed vault documents → rows + citations
- `run-agent`: executes a codified agent end-to-end (gather context → reason → write output → route follow-ups)
- `agent-scheduler-tick` (cron): enqueues due scheduled agents

## 6. AI strategy

- `packages/ai` exposes `extractDeck(text, fields)`, `triageEmail(email)`,
  `classifyUpdate(text)`, `assistantTurn(messages, tools)` behind a provider interface:
  - `mock`: deterministic heuristic extractor (regex + section parsing) — zero cost, offline
  - `openai`: any OpenAI-compatible endpoint (OpenAI, Bedrock gateway, vLLM…) using JSON-schema structured output
- Credits: every billable op writes to `credit_ledger`; balance check before run.
- The in-product copilot is a loop over the SAME MCP tools the external agents get.

## 7. Auth posture

Deferred by design. Today: `X-API-Key` header (workspace-scoped `api_keys` table) +
dev default workspace resolution. Supabase JWT integration lands later; the API
auth layer is isolated in one hook so swapping providers is a one-file change.

## 8. Deployment target (when ready)

- **Demo / VenLabs:** Vite SPA on Vercel; Fastify API + workers on Render/Fly/Railway;
  Supabase Postgres (session pooler) + Supabase Storage (S3 API). See `docs/DEPLOY.md`.
- **AWS-shaped:** ECS Fargate (api, mcp-http); RDS Postgres Multi-AZ; S3; SES inbound.
- Secrets in the host's secret store / SSM; env matrix in `docs/DEPLOY.md`.
- Fastify is not adapted to Vercel serverless (SSE, large uploads, pg-boss).

## 9. Quality gates

- TypeScript strict everywhere; turbo `build/lint/typecheck/test` pipelines
- Vitest unit tests per package; smoke script seeds + exercises ingestion E2E
