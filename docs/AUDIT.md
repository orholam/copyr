# Roulette ↔ VentureLabs parity audit

Sources audited: `/` (landing), `/features`, `/blog` (+ post topics), `/changelog`,
`/auth/sign-in`, `/auth/sign-up`, `/auth/password-reset` (linked),
`/privacy-policy`, `/terms-of-service`. `/about` 404s upstream (footer link only).

Legend: ✅ done · 🟡 partial · ❌ missing → implemented in this goal unless deferred below.

## A. Marketing & content site
| Item | Status |
|---|---|
| Landing hero/features/pricing/FAQ | ✅ |
| Feature tabs section | ✅ |
| **Theme toggle (dark/light)** | ✅ |
| **Blog index + posts** | ✅ |
| **Changelog index + entries** | ✅ |
| **Legal: privacy/terms/cookie** | ✅ |
| **Auth screens: sign-in / sign-up / password-reset** | ✅ (Supabase email+password; no Google) |
| Footer nav incl. Company/Resources/Legal columns | ✅ (extend links) |

## B. Product features surfaced by legal/changelog
| Item | Source | Status |
|---|---|---|
| Custom fields/stages | features | ✅ |
| Email ingestion + forwarding | features/privacy | ✅ |
| Link conversion (DocSend/Pitch/Drive) | features | ✅ |
| AI extraction into custom fields | features | ✅ |
| Kanban/table pipeline views | features | ✅ |
| Relationship intel | features | ✅ |
| Portfolio update timeline | features | ✅ |
| Analytics dashboard | changelog | ✅ |
| Share links (attrs/password/expiry/access logs) | features | ✅ |
| API keys / REST API | features/ToS | ✅ |
| **Tags & labels** | ToS 2.1, privacy 2.1 | ✅ |
| **@mentions in notes** | privacy 2.1, ToS 2.1 | ✅ |
| **Data export (CSV/JSON)** | privacy 6.3 | ✅ |
| **Browser-extension capture endpoint** | ToS 4.3, privacy 2.1 | ✅ (API + MCP tool; extension binary later) |
| **Integrations settings (Gmail/Zapier/Tally)** | privacy 2.3/4.1, ToS 2.1 | ✅ (Gmail = limited-use disclosure UI, connect gated on auth phase) |
| **Rate limiting** | changelog | ✅ |
| **Workspace audit log view** | changelog | ✅ (activity feed already exists; expose page) |
| **AI investment thesis generation** | ToS 2.1 | ✅ (+ MCP tool) |
| **Credit top-up purchase flow** | ToS 6.3 | ✅ endpoint + UI (Stripe checkout at billing phase) |
| Notification preferences | privacy 7.4 | ✅ UI (persisted locally until auth) |
| SSO/SAML, MFA | changelog | 🟡 settings stubs marked enterprise (real impl w/ Supabase) |
| Gmail read-only sync (`gmail.readonly`) | privacy 2.4 | ⏸ deferred — needs OAuth consent setup; disclosure text shipped |
| Live cursors / presence / collaborative editing | changelog | ⏸ deferred (heavy realtime; SSE foundation exists) |
| Mobile apps (iOS/Android) | changelog | ⏸ deferred — responsive web covers flows |
| Custom workflow automation engine | changelog | ⏸ deferred (roadmap Phase 5+) |
| Zapier/Tally *outbound* integrations | ToS | 🟡 inbound webhook URLs provided (Zapier can POST them) |

Deferred items remain documented here and in ROADMAP.md — they require external accounts,
OAuth app review, native builds, or a separate automation engine milestone; none are
visible gaps in a 1-1 *product* tour except where noted as 🟡.


## Phase-3 audit (category B — automation & platform)

| Item | Source | Status |
|---|---|---|
| Workflow engine v1 (event triggers → conditions → multi-step actions → run history) | Changelog "custom workflows and automation" | ✅ `workflows`/`workflow_runs`, evaluator worker, chain-depth loop guard, dry-run testing; UI: Settings → Automations; MCP: create_workflow/test_workflow/list_* |
| Outbound webhooks (HMAC-SHA256 signed payloads, retry/backoff, delivery log) | ToS integration ecosystem | ✅ `webhook_subscriptions`/`webhook_deliveries`; UI: Settings → Webhooks; MCP tools |
| Form-based workflow builder UI | Changelog | ✅ (form builder; visual canvas deferred with (d)) |
| Granular RBAC permission sets | Changelog "enhanced access controls" | ✅ role defaults + per-member grants, enforced server-side; settings tabs permission-gated |
| Per-plan API rate-limit tiers | Changelog "smarter rate limiting" | ✅ trial/monthly/yearly/custom tiers via workspace plan lookup |
| Chrome extension | ToS 4.3, Privacy 2.1 | ✅ MV3 extension in `apps/extension` (load-unpacked), one-click capture → pipeline |
| Tally/Zapier field-mapping docs + endpoints | ToS 2.1 | ✅ Integrations tab documents endpoints & field mapping; intake/capture endpoints accept them |
| DB-persisted notification preferences | Privacy 7.4 | ✅ per-membership settings, Security tab |
| Exportable analytics visualizations | Changelog "exportable data visualizations" | ✅ one-click PNG export on dashboard charts |
| Presence indicators ("who's viewing") | Changelog team collaboration | ✅ SSE presence channel + viewer avatars on company pages (cursors/editing remain (d)) |

Verification for this phase: typecheck 16/16 · tests 16/16 · web build ✓ ·
`e2e-b.sh` ALL CATEGORY-B CHECKS PASSED (7/7) · SSE stream verified live.


## Final hardening pass (quality refinement)

| Weakness found | Fix |
|---|---|
| Duplicate-company guard was unreachable dead code | Dedupe always enforced; `mergeWithExisting` opt-in; UI links to the existing record |
| Company merge missing | Full merge (deals/docs/notes/contacts/portfolio/relationships/field-values repoint; survivor gap-fill; audit trail) |
| Relationship intelligence had no endpoint/UI | `GET /companies/:id/relationships` + "Team connections" card |
| Webhook retries never actually retried | Exponential backoff via scheduled re-enqueue (30s→600s, max 5 attempts) |
| AI provider responses never validated (real OpenAI returned off-contract intents, hallucinated company matches, omitted fields) | `withContractEnforcement` normalization layer + strict JSON Schema for triage + deterministic anti-hallucination filter + never-lose-a-lead sender-domain fallback |
| Share links / intake form / thesis / tags had no or lost UI | Share modal + public viewer page (`/share/:token` w/ password unlock), public pitch form page (`/public/forms/:slug`), thesis button, tag editor — all restored in current design system |
| Pipeline lacked tags column/filter/export | Tags column, click-to-filter chips, ⬇ CSV export |
| Analytics conversion Δ hardcoded 0 | Real prior-period computation |
| Inbox attachments invisible | Attachment chips |
| ESLint declared but unconfigured | Root flat config (typescript-eslint), wired into turbo + CI |
| MCP stdio transport untested | `scripts/mcp-stdio-smoke.mjs` protocol smoke test (105 tools verified) |

Final state: lint 9/9 · typecheck 16/16 · tests 16/16 · web build ✓ ·
E2E core 8/8 · E2E automation 7/7 · MCP stdio smoke OK.


## Landing-page claim audit (final pass)

Every pitch on the landing page was verified against the running app:

| Claim | Verdict |
|---|---|
| "Forward an email, paste a DocSend link, or drop a PDF" | ✅ all three ingestion paths live |
| "Convert DocSend links" / "Links never expire" | ✅ permanent PDF conversion + storage |
| "Parse pitch decks" / "Auto-fill CRM fields" | ✅ schema-driven extraction |
| "Extract company data" / "Draft investment memos" | ✅ thesis generation |
| "Track communications" / "Relationship intelligence" | ✅ relationships graph + team connections card |
| "Forward emails" / "your VentureLabs address" | ✅ **NEW:** workspace inbound address shown in Settings → Integrations |
| "Manage pipeline" / board + table | ✅ |
| "Custom attributes" | ✅ field builder |
| "Team collaboration" | ✅ presence avatars + @mentions |
| "Tags, saved filters & CSV/JSON export" | ✅ **saved filters NEW** (`saved_views` table, save/apply/delete chips on Pipeline) |
| "REST API with OpenAPI spec" | ✅ **NEW:** `/api/v1/openapi.json` (49 paths) |
| "Duplicate emails collapse automatically" | ✅ messageId dedupe |
| "Public intake forms & browser capture endpoint" | ✅ incl. public form page at /public/forms/:slug |
| "Bulk upload with automatic parsing" / "100+ decks one drop" | ✅ multi-file upload |
| "Live statuses: queued → processing → processed" | ✅ |
| Workflow automations ("custom workflows… respond to events") | ✅ engine + builder UI |
| Outbound webhooks / Zapier-compatible | ✅ signed deliveries + retry |
| Exportable visualizations | ✅ chart PNG export |

Remaining marketing copy that is aspirational-only (plan-gated or needs external
services — unchanged from the category C/D list): SAML SSO (stub), Gmail readonly
sync (needs Google verification), mobile apps, 99.5% SLA wording.
