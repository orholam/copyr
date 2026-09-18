# VentureLabs Roadmap

Multi-session build plan. Each phase ends with a working, verifiable system.

## Phase 1 — Foundation ✅ (done)
- [x] Strategy + architecture docs
- [x] Monorepo scaffold (pnpm + turbo), docker-compose (postgres/minio/mailpit)
- [x] `@copyr/config`, `@copyr/db` (full 22-table schema + migrations + rich seed)
- [x] `@copyr/contracts` zod DTOs/events/tool IO
- [x] `@copyr/storage`, `@copyr/ai` (deterministic offline mock + OpenAI-compatible)
- [x] `@copyr/core` services + pg-boss jobs (process-email, parse-document, convert-link, extraction)
- [x] `apps/api` REST v1 + SSE + inbound-email webhook + simulate endpoint
- [x] Smoke E2E: seed → ingest email → deal created → deck parsed → fields AI-extracted → credits spent

## Phase 2 — MCP + API completeness ✅ (done)
- [x] `apps/mcp` stdio + streamable HTTP; **34 tools** + resources + prompts
- [x] Per-request tenant isolation (AsyncLocalStorage), session-affine MCP sessions
- [x] Analytics endpoints + trends
- [x] Share links (password/expiry/access logs/signed doc URLs) + public viewer
- [x] Intake forms (public GET/POST → company+deal+auto link-conversion)

## Phase 3 — Web app ✅ (core done, polish ongoing)
- [x] App shell, routing, design primitives, SSE-driven cache invalidation
- [x] Pipeline kanban (drag-and-drop w/ fractional ordering) + table views + search
- [x] Add-company modal (link / upload / manual tabs)
- [x] Inbox w/ live statuses, AI results, reprocess, simulator button
- [x] Company detail: attributes grid, documents, notes, timeline, contacts
- [x] Portfolio timeline, analytics dashboard (stat cards + charts)
- [x] Settings: stages, custom-field builder, API keys, intake forms
- [x] Marketing site (hero, how-it-works, features tabs, pricing, FAQ)

## Phase 4 — Intelligence (in progress)
- [ ] In-product copilot panel over MCP tools (endpoint exists in core surface; UI next)
- [ ] Real LLM extraction tuning (chunked long PDFs, image OCR fallback)
- [x] Duplicate company detection & merge flow
- [ ] Bulk email dump processing UX (review N drafted deals at once)
- [ ] Real link-conversion providers (Playwright screenshots) behind existing interface
- [ ] Saved views / table column persistence

## Phase 4.5 — Operating platform (Harvey-style surfaces) ✅ (done)
- [x] **Diligence Vaults**: bulk containers per data room; review tables extract
  structured rows with citation quotes across every parsed document; locked rows
  survive reruns; credit-metered (`vault_review`)
- [x] **Grounded research (Knowledge)**: cited Q&A over documents/notes/updates/
  emails/memories; persisted reports; `research_report` credits
- [x] **Codified agents + Thesis Builder**: thesis_screen / diligence_checklist /
  portfolio_monitor / custom; run logs with steps; scheduled agents via scheduler
  tick; system agents auto-seeded; runs write review-ready output (screening notes,
  checklist tasks, portfolio briefings)
- [x] **Spaces & tasks**: context bundles (company/deals/docs/notes/updates/tasks/
  participants/activity); tasks route to users or trigger agent runs
- [x] **Memory**: fund-wide and per-user preferences/facts/processes; declared +
  learned; grounds every answer
- [x] **Command Center**: adoption analytics, AI-vs-human leverage ratio, credit
  economics by reason, cross-workspace anonymized benchmarks, recommendations
- [x] Full MCP surface (105 tools), REST parity, web pages (Diligence / Agents /
  Command Center), rich seed demo
- [ ] External intelligence service integration into Knowledge grounding
  (`intelligence/` ships separately)

## Phase 5 — Productionization
- [x] Dockerfiles (web/api/mcp) + prod compose profile
- [x] AWS deploy guide (docs/DEPLOY.md: ECS/RDS/S3/SES topology + env matrix)
- [x] CI (lint/typecheck/test/migrate/smoke/build/docker)
- [x] ESLint (flat config, typescript-eslint) across all packages
- [x] E2E suites in-repo (`pnpm e2e`, `pnpm e2e:b`) + MCP stdio smoke test
- [x] Workflow/automation engine v1 + outbound webhooks (see docs/AUDIT.md phase-3 table)
- [x] Supabase auth integration (swap point isolated in `resolveSession`)
- [ ] IaC (CDK or Terraform), OTel tracing, alerting
- [x] Supabase Postgres + Storage wiring + Vercel/Render demo deploy path (`docs/DEPLOY.md`)
