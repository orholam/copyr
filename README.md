# Copyr

**AI-native operating platform for venture capital** — deal flow, diligence, and
portfolio operations in one system. Every capability is exposed to AI agents via MCP;
the React UI is just another client of the same core.

```
Forward an email ──▶ AI triage ──▶ company + deal created ──▶ deck parsed ──▶ fields extracted
Drop 100 PDFs into a Vault ──▶ bulk parse ──▶ review table extracts terms + citations across ALL of them
Ask the corpus a question ──▶ grounded answer with citations (docs, notes, updates, emails, fund memory)
Codify your thesis once ──▶ agents screen every inbound deal, provision checklists, watch the portfolio
```

## Quick start

```bash
pnpm install
pnpm db:up                 # postgres :5433, minio :9000, mailpit :8025 (SMTP :1025)
pnpm db:migrate && pnpm db:seed

pnpm dev                   # api :4100 · web :5173 · mcp-http :4200
# or individually:
pnpm --filter @copyr/api dev
pnpm --filter @copyr/web dev
pnpm --filter @copyr/mcp dev          # streamable HTTP at /mcp
pnpm --filter @copyr/mcp run stdio    # stdio transport for local agents

pnpm smoke                 # end-to-end pipeline proof (email → deal → extraction)
pnpm e2e                   # REST E2E suite (core flows)
pnpm e2e:b                 # automation/webhooks/RBAC E2E suite
pnpm mcp:smoke             # MCP stdio protocol smoke test
```

Open **http://localhost:5173** — seeded firm "Harbor Ventures" with 12 companies,
a diligence vault with extracted contract terms, codified agents (Thesis Screener /
Diligence Checklist / Portfolio Monitor), a live deal space, fund memories and
cited research reports.

## Platform surfaces

| Surface | What it does |
|---|---|
| **Assistant** | The home surface: one central chat wired to the **full main MCP surface** (all 60+ tools via an in-process bridge) — pipeline, vaults, research, agents, memory — with persisted thread History. `/app` opens straight into it |
| **Pipeline** | Ingestion (email/link/bulk upload/form), AI triage + structured extraction, kanban/table views, relationship intel |
| **Diligence (Vaults)** | Bulk-review container per data room; **review tables** run one structured query across every parsed document — rows cite their source quotes; locked rows survive reruns |
| **Knowledge** | `ask` over the workspace corpus (documents, notes, portfolio updates, emails, memories) returns cited answers, persisted as reports |
| **Automations** | One unified system: **agents** (codified judgment — thesis screens, diligence checklists, portfolio monitors) + **workflows** (WHEN event IF conditions THEN actions, including `run_agent` to dispatch judgment mid-flow). Agents completing fire workflow events gated on their output (`output.recommendation eq advance` → act). Merged runs feed, dry-run testing, loop-safe chaining |
| **Spaces** | Context containers binding company/deal/vault/tasks/participants — agents open inside them so work never starts from scratch; tasks route to teammates *or* trigger agent runs |
| **Memory** | Declared + learned fund/partner preferences that scope every AI answer; inspectable, deletable, never trained on |
| **Command Center** | Adoption analytics across surfaces, AI-vs-human leverage ratio, credit economics, anonymized cross-workspace benchmarks, prioritized recommendations |

### Drive it with an agent (Claude Desktop / opencode / any MCP client)

```json
{
  "mcpServers": {
    "copyr": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/copyr", "--filter", "@copyr/mcp", "run", "stdio"],
      "env": { "COPYR_WORKSPACE_SLUG": "harbor-ventures" }
    }
  }
}
```

**105 tools** with full create/read/update/delete lifecycle across pipeline
(`list_deals`, `ingest_email`, …), vaults (`create_vault`, `add_documents_to_vault`,
`create_review_table`, `get_review_table`), knowledge (`ask_knowledge`, reports),
agents (`create_agent`, `run_agent`, `get_agent_run`), spaces & tasks, memory
(`remember`, `recall_memories`) and governance (`command_center_overview`) — plus
admin surfaces (API keys, intake forms, webhooks, share links), listable resources
(`copyr://deals/{id}`, `copyr://vaults/{id}`, `copyr://spaces/{id}`,
`copyr://agents/{id}`, `copyr://research/{id}`, workspace snapshots) and prompts
(`triage-inbox`, `run-diligence`, `portfolio-monitor`, `weekly-pipeline-review`,
`company-deep-dive`, `quarterly-portfolio-review`, `onboard-workspace`,
`build-automation`).

Remote agents: `POST http://localhost:4200/mcp` (streamable HTTP; `X-Workspace-Slug` or `X-API-Key`).

### Simulate the flagship flow

```bash
curl -X POST localhost:4100/api/v1/emails/simulate -H 'content-type: application/json' \
  -d '{"companyName":"Nimbus Robotics","round":"Series A","askUsd":8000000,"arrUsd":1400000,"sectorHint":"robotics"}'
# watch it become a processed deal in the inbox/pipeline within seconds
```

Real inbound email: point Mailpit's webhook (`docker-compose.yml`) or AWS SES at
`POST /api/v1/webhooks/inbound-email?secret=…&workspace=…`.

## Monorepo

| Package | Role |
|---|---|
| `apps/web` | React SPA: marketing site + pipeline/inbox/portfolio/analytics/settings |
| `apps/api` | Fastify REST `/api/v1`, SSE realtime, webhooks, serves SPA in prod |
| `apps/mcp` | MCP server — stdio + streamable HTTP, 100+ tools, resources, prompts |
| `packages/core` | Domain services + pg-boss jobs (**the heart**; API/MCP/copilot are shells) |
| `packages/ai` | Provider abstraction: deterministic offline `mock` + OpenAI-compatible |
| `packages/db` | Drizzle schema (22 tables), migrations, rich seed |
| `packages/contracts` | Zod DTOs/filters/events — single source of truth |
| `packages/storage` | S3-compatible object store (MinIO locally) |

Design principles & data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Production (Supabase + Vercel/Render): [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Configuration

Copy `.env.example` → `.env`. Highlights:
- `AI_PROVIDER=mock` runs fully offline/free; set `openai` + `OPENAI_API_KEY` for real LLMs.
- `DEV_WORKSPACE_SLUG` scopes requests until Supabase auth lands.
- Agents authenticate via `POST /api-keys` (Settings → API Keys in the app).

Production (venlabs-demo): point `DATABASE_URL` at the Supabase **session** pooler and
`STORAGE_ENDPOINT` at the Storage S3 API. See [`.env.example`](.env.example) (commented
block) and [`docs/DEPLOY.md`](docs/DEPLOY.md). Never commit secrets.

Shareable demo: Vite SPA on **Vercel** (`vercel.json` + `apps/web/vercel.json`) + Fastify API on **Render/Fly/Railway**
(`render.yaml`, `Dockerfile.api`).

**The API must be a separate host.** Fastify is not deployed as Vercel serverless
(SSE, uploads, pg-boss workers). Vercel env is only `VITE_API_URL` + `VITE_WORKSPACE_SLUG`.
Supabase `DATABASE_URL` / Storage S3 vars go on the API host — see [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Status

See [`docs/ROADMAP.md`](docs/ROADMAP.md). Phase 1–3 core is complete and E2E-tested:
ingestion (email/link/upload/manual/form), AI triage+extraction w/ credits, kanban/table
pipeline, relationship intel, portfolio timelines, share links w/ access logs, analytics,
MCP everywhere. Remaining: copilot polish, duplicate merge, real link-converter providers,
Supabase auth, IaC.
