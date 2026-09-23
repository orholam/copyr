# VentureLabs — deployment

> **The Fastify API must be a separate host. Do not put it on Vercel.**
> Vercel serves only the Vite SPA (`apps/web`). The API needs a long-running
> process (SSE, 100MB uploads, pg-boss workers). Use Render / Fly / Railway
> (`Dockerfile.api`, `render.yaml`). Without that host, the marketing site still
> deploys; `/app` API calls will 404.

## Ship now (Vercel SPA)

1. Import this repo in Vercel via **Continue with Origin** (VenLabs does not
   import GitHub). Until an Origin copy exists, see [`docs/ORIGIN.md`](ORIGIN.md).
2. **Root Directory:** leave empty (repo root) **or** set `apps/web`.
   - Empty → uses repo-root `vercel.json` (Vite output is copied to `./dist`).
   - `apps/web` → uses `apps/web/vercel.json` (install/build still run from the monorepo root).
   - If the dashboard is already set to `apps/api` (GitHub integration default for this
     project), `apps/api/vercel.json` still builds the **SPA** — it does not deploy Fastify.
     Prefer changing Root Directory to empty or `apps/web`.
   Keep **Output Directory** as `dist` (or clear the dashboard override so `vercel.json` applies).
3. Framework: Other / Vite (commands are in `vercel.json`).
4. Vercel env (Production + Preview, **build** time):

```bash
VITE_API_URL=https://<your-api-host>
VITE_SUPABASE_URL=https://cdsngnauduhiaidzncie.supabase.co
VITE_SUPABASE_ANON_KEY=<legacy anon JWT from Project Settings → API>
VITE_WORKSPACE_SLUG=harbor-ventures
```

`VITE_API_URL` can wait until the API is up. Redeploy the SPA after setting Vite env (Vite inlines it). Never put a service-role key in Vercel.

## venlabs-demo env (API host — not Vercel)

Project: [venlabs-demo](https://cdsngnauduhiaidzncie.supabase.co) · ref `cdsngnauduhiaidzncie`

Set these on **Render/Fly/Railway** (and in a local `.env` for `pnpm db:migrate`). Never commit secrets.

### Postgres

Dashboard → **Project Settings → Database**. Use the **session pooler (port 5432)** as `DATABASE_URL`. pg-boss needs `LISTEN/NOTIFY`; the **transaction** pooler (port 6543) cannot run it.

```bash
DATABASE_URL=postgresql://postgres.cdsngnauduhiaidzncie:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require

# Optional — query pool only (never pg-boss / migrate):
DATABASE_POOL_URL=postgresql://postgres.cdsngnauduhiaidzncie:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require

DATABASE_SSL=auto
```

Direct URL (IPv6): `postgresql://postgres:[DB-PASSWORD]@db.cdsngnauduhiaidzncie.supabase.co:5432/postgres?sslmode=require` — prefer the pooler on Render.

Then: `pnpm db:migrate` (renames a non-VentureLabs `public.deals` scaffold instead of dropping it) and optional `pnpm db:seed`.

### Storage (S3-compatible)

Dashboard → **Storage → S3**. Enable S3 protocol, create private bucket `copyr`, mint access keys.

```bash
STORAGE_ENDPOINT=https://cdsngnauduhiaidzncie.storage.supabase.co/storage/v1/s3
STORAGE_REGION=[PROJECT-REGION]
STORAGE_BUCKET=copyr
STORAGE_ACCESS_KEY_ID=[SUPABASE-S3-ACCESS-KEY]
STORAGE_SECRET_ACCESS_KEY=[SUPABASE-S3-SECRET-KEY]
STORAGE_FORCE_PATH_STYLE=true
```

Also on the API host: `PUBLIC_URL=https://<api-host>`, `WEB_URL=https://<vercel-host>`, `CORS_ALLOW_VERCEL_PREVIEWS=true`, `AUTO_MIGRATE=true`, `ALLOW_DEV_WORKSPACE_AUTH=false`, plus the Auth vars in **§5**.

Placeholders: [`.env.example`](../.env.example). Local docker is unchanged (`pnpm db:up` → `:5433` / MinIO `:9000`).

## Topology

```
  browser ──▶  Vercel (Vite SPA)  ──REST/SSE──▶  Render/Fly/Railway (Fastify API + workers)
                                                    │
                                                    ├─ Supabase Postgres  (session pooler + optional txn pooler)
                                                    └─ Supabase Storage   (S3-compatible API)
```

Fastify is **not** deployed on Vercel serverless. The API holds SSE streams, 100MB
multipart uploads, and **pg-boss workers in-process** — none of those fit a
request-scoped function without a larger rewrite. The SPA is static and belongs
on Vercel; the API is a long-running Node/Docker service.

Auth: the SPA signs in with Supabase email+password (`@supabase/supabase-js`) and
sends `Authorization: Bearer <access_token>`. The API verifies the JWT in
`resolveSession` and maps the user to a workspace membership. API keys remain
for agents. Slug-only access (`X-Workspace-Slug` / `DEV_WORKSPACE_SLUG`) is
gated by `ALLOW_DEV_WORKSPACE_AUTH`, which defaults **off** in production.

## venlabs-demo (Venture Labs)

| | |
|---|---|
| Project | `venlabs-demo` |
| Project URL | https://cdsngnauduhiaidzncie.supabase.co |
| Project ref | `cdsngnauduhiaidzncie` |
| Database | Postgres (existing thin `public.deals` scaffold is **renamed**, not dropped, by `pnpm db:migrate`) |
| Storage | S3 protocol at `https://cdsngnauduhiaidzncie.storage.supabase.co/storage/v1/s3` |

Do **not** put real passwords, service-role keys, or S3 secrets in git. Use the
placeholders in `.env.example` and the host's secret store.

## 1. Supabase Postgres

Dashboard → **Project Settings → Database**.

Use the **session pooler** (port **5432**) as `DATABASE_URL`. pg-boss needs
`LISTEN/NOTIFY`, which the **transaction** pooler (port **6543**) does not
support.

```bash
# Session pooler — migrations, pg-boss, default query pool
DATABASE_URL=postgresql://postgres.cdsngnauduhiaidzncie:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require

# Optional: transaction pooler for the app query pool only (more multiplexed)
DATABASE_POOL_URL=postgresql://postgres.cdsngnauduhiaidzncie:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
```

- `[REGION]` is the project's AWS region (shown next to the pooler host).
- `[DB-PASSWORD]` is the database password (reset from Database settings if unknown).
- `DATABASE_SSL=auto` (default) turns on TLS for `*.supabase.co` / `pooler.supabase.com`.
- Prefer the pooler over `db.<ref>.supabase.co` so IPv4-only hosts (Render, GitHub Actions) can connect.

### Migrate

```bash
# from a machine that can reach Supabase (or the API host's shell)
export DATABASE_URL='postgresql://postgres.cdsngnauduhiaidzncie:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require'
pnpm db:migrate
pnpm db:seed          # optional Harbor Ventures demo data
```

`pnpm db:migrate` will:

1. Connect with TLS when the host looks like Supabase.
2. If `public.deals` exists **without** VentureLabs columns (`workspace_id`, `pipeline_id`, `stage_id`), rename it to `deals_scaffold` (or `deals_scaffold_N`) and rename colliding `deals_*` constraints/indexes. Rows are kept.
3. Apply Drizzle migrations from `packages/db/drizzle`.
4. `ENABLE ROW LEVEL SECURITY` on public tables with no policies, so the Supabase anon key cannot read VentureLabs tables via PostgREST. The API uses the `postgres` role (`BYPASSRLS`).

On Render, migrate runs in **two** places so a dashboard override cannot skip schema updates again:

1. **`preDeployCommand: pnpm db:migrate`** in [`render.yaml`](../render.yaml) — applies `packages/db/drizzle` in the new image **before** traffic switches. A failed migrate cancels the deploy. Requires a paid instance; if the command is missing in the dashboard, add **Pre-Deploy Command** = `pnpm db:migrate`.
2. **`AUTO_MIGRATE=true`** on API boot (also set in `render.yaml`). The Render **dashboard env wins** over the blueprint. `AUTO_MIGRATE=false` there is what left production on a pre-merge `companies` table after the company-deal deploy.

If `0007` was never applied, either run `pnpm db:migrate` against the session-pooler `DATABASE_URL`, or paste [`docs/sql/hotfix-companies-pipeline-columns.sql`](sql/hotfix-companies-pipeline-columns.sql) in the Supabase SQL editor (nullable columns + optional backfill from `deals`; does **not** drop `deals`). Then set dashboard `AUTO_MIGRATE=true` and redeploy so drizzle records `0007_dapper_chamber`.

Local docker-compose is unchanged: `pnpm db:up` then `pnpm db:migrate` against `localhost:5433`.

### Company-deal merge (`0007_dapper_chamber`) — schema drift

Current `main` treats a **company as the pipeline card**. `packages/db/src/schema.ts` `companies` expects these columns (added in [`packages/db/drizzle/0007_dapper_chamber.sql`](../packages/db/drizzle/0007_dapper_chamber.sql)):

| Column | TypeScript / SQL type | Nullability in 0007 |
|---|---|---|
| `pipeline_id` | `uuid` → `pipelines.id` | `NOT NULL` after backfill |
| `stage_id` | `uuid` → `stages.id` | `NOT NULL` after backfill |
| `owner_user_id` | `uuid` → `users.id` | nullable |
| `round_stage` | `text` | nullable |
| `ask_amount` | `numeric(14, 2)` | nullable |
| `valuation` | `numeric(14, 2)` | nullable |
| `priority` | `integer` default `0` | `NOT NULL` |
| `position` | `text` default `'a0'` | `NOT NULL` |
| `next_step_at` | `timestamptz` | nullable |
| `archived_at` | `timestamptz` | nullable |
| `source_ref` | `text` | nullable |

Indexes: `companies_ws_pipeline_idx (workspace_id, pipeline_id)`, `companies_stage_idx (stage_id, position)`.

Missing `archived_at` 500s `GET /api/v1/analytics/overview`. Missing `stage_id` 500s `GET /api/v1/deals`. This is **not** CORS/`WEB_URL`.

**Immediate SQL** (same types as `schema.ts`; leave `stage_id` / `archived_at` nullable so existing rows survive). Full script: [`docs/sql/hotfix-companies-pipeline-columns.sql`](sql/hotfix-companies-pipeline-columns.sql).

```sql
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stage_id uuid;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS position text DEFAULT 'a0' NOT NULL;
CREATE INDEX IF NOT EXISTS companies_stage_idx
  ON public.companies USING btree (stage_id, position);
```

Also add the other 0007 columns in that file (`pipeline_id`, `owner_user_id`, `round_stage`, `ask_amount`, `valuation`, `priority`, `position`, `next_step_at`, `source_ref`) or the next route will 500. Do **not** `SET NOT NULL` or `DROP TABLE deals` from the SQL editor unless you are running the full 0007 file; `pnpm db:migrate` does that after copying deal rows onto companies.

Confirm:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'companies'
  AND column_name IN ('archived_at', 'stage_id', 'pipeline_id');

SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at;
```

`0007_dapper_chamber` is applied when that journal has 8 rows (idx 0–7). If the hotfix ran but drizzle has not, the next `pnpm db:migrate` still applies 0007 (`ADD COLUMN IF NOT EXISTS` is a no-op; it then remaps child `deal_id`s and drops `public.deals`).

## 2. Supabase Storage (S3 protocol)

Dashboard → **Storage → Settings / S3**.

1. Enable the S3 protocol.
2. Create an S3 access key; copy access key id + secret.
3. Create a **private** bucket named `copyr` (or any name you put in `STORAGE_BUCKET`).
4. Bucket CORS: allow the Vercel origin (`GET`, `HEAD`) so signed download URLs work in the browser.

```bash
STORAGE_ENDPOINT=https://cdsngnauduhiaidzncie.storage.supabase.co/storage/v1/s3
STORAGE_REGION=[PROJECT-REGION]          # same region as the project, e.g. us-east-1
STORAGE_BUCKET=copyr
STORAGE_ACCESS_KEY_ID=[SUPABASE-S3-ACCESS-KEY]
STORAGE_SECRET_ACCESS_KEY=[SUPABASE-S3-SECRET-KEY]
STORAGE_FORCE_PATH_STYLE=true
```

`@copyr/storage` already uses the AWS SDK v3 S3 client (MinIO locally, this endpoint in prod). No adapter swap is required.

## 3. Public demo URL (Vercel SPA + Render API)

### API (Render / Fly / Railway)

Recommended: **Render** with the repo `Dockerfile.api` and `render.yaml`.

| Var | Notes |
|---|---|
| `DATABASE_URL` | Session pooler (required) |
| `DATABASE_POOL_URL` | Transaction pooler (optional) |
| `STORAGE_*` | Supabase S3 values above |
| `PUBLIC_URL` | Public API origin, e.g. `https://copyr-api.onrender.com` |
| `WEB_URL` | Vercel origin, e.g. `https://copyr.vercel.app` |
| `CORS_ALLOW_VERCEL_PREVIEWS` | `true` so `*.vercel.app` previews can call the API |
| `AUTO_MIGRATE` | `true` on Render (do **not** set `false` in the dashboard — it overrides `render.yaml`) |
| `ALLOW_DEV_WORKSPACE_AUTH` | `false` in production (do not re-enable slug-only “any header” auth) |
| `SUPABASE_URL` | `https://cdsngnauduhiaidzncie.supabase.co` |
| `SUPABASE_JWT_SECRET` | Dashboard → Project Settings → API → JWT Secret (legacy HS256). Server-only. |
| `SUPABASE_ANON_KEY` | Same dashboard page, **legacy anon** JWT. Used only if JWKS/secret verification needs the Auth `/user` fallback. Not a service-role key. |
| `AI_PROVIDER` | `mock` for a free demo; `openai` + `OPENAI_API_KEY` for real LLMs |
| `INBOUND_WEBHOOK_SECRET` | rotate from the `.env.example` default |

Health check: `GET /health`.

Fly.io: `fly launch --dockerfile Dockerfile.api` and set the same env. Railway: new service from `Dockerfile.api`.

Optional MCP HTTP: `Dockerfile.mcp` with `pnpm --filter @copyr/mcp dev` / `src/http.ts` on port 4200. Not required for the web demo.

### Web (Vercel)

**API is not on Vercel.** Root `vercel.json` (empty Root Directory), `apps/web/vercel.json` (Root Directory `apps/web`), or `apps/api/vercel.json` (if Root Directory is still `apps/api`) all build the SPA.

1. Import `orholam/copyr` in Vercel.
2. Root Directory: empty **or** `apps/web`.
3. Build-time env: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (see Ship now above). `VITE_WORKSPACE_SLUG` is optional (legacy demo hint).

After the first Vercel URL exists, set `WEB_URL` on the API to that origin.

Shareable demo: **https://&lt;project&gt;.vercel.app** (SPA) talking to the Render API.

## 4. Local docker path (unchanged)

```bash
pnpm install
pnpm db:up                 # postgres :5433, minio :9000, mailpit :8025
pnpm db:migrate && pnpm db:seed
pnpm dev                   # api :4100 · web :5173 · mcp-http :4200
```

`docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build` still runs API + MCP + nginx web against local Postgres/MinIO.

---

## Alternative: AWS (ECS / RDS / S3)

Target topology if you are not using Supabase:

```
                    ┌────────────┐
  SES inbound ────▶ │  API task  │ ◀── ALB ◀── CloudFront ── S3 (web assets)
  (emails → S3 →    │ ECS Fargate│                │
   webhook)         │  + workers │             /mcp proxied
                    └─────┬──────┘        ┌──────▼─────┐
                          │               │ MCP task   │ (streamable HTTP)
                    ┌─────▼──────┐        │ ECS Fargate│
                    │ RDS PG     │◀──────▶└────────────┘
                    │ Multi-AZ   │   pg-boss shares Postgres
                    └─────┬──────┘
                    ┌─────▼──────┐
                    │ S3 bucket  │ decks/PDFs (private, signed URLs)
                    └────────────┘
```

| Var | Local | AWS prod |
|---|---|---|
| `DATABASE_URL` | docker compose postgres | RDS cluster endpoint |
| `STORAGE_ENDPOINT` | MinIO | *(unset — native S3)* |
| `STORAGE_BUCKET` | copyr-local | copyr-prod-&lt;account&gt; |
| `AI_PROVIDER` | mock | openai (or Bedrock-compatible gateway) |
| `INBOUND_WEBHOOK_SECRET` | dev value | Secrets Manager |
| `DEV_WORKSPACE_SLUG` | harbor-ventures | unused when JWT/API-key auth is required |
| `ALLOW_DEV_WORKSPACE_AUTH` | true (default in development) | `false` |

1. **Network**: VPC with private subnets for ECS + RDS; NAT or VPC endpoints for ECR/S3.
2. **Data**: RDS Postgres 16 Multi-AZ; run `pnpm --filter @copyr/db migrate` as a one-off ECS task.
3. **Storage**: S3 bucket, block public access, CORS for the web origin; presigned URLs already used by core.
4. **Email**: SES receive set → S3 → Lambda POST to `/api/v1/webhooks/inbound-email?secret=…` (idempotent per `messageId`).
5. **Compute**: API Fargate from `Dockerfile.api`; split workers with `API_RUN_WORKERS=false` if needed. MCP: `Dockerfile.mcp` at `/mcp*`.
6. **Web**: SPA `dist/` → S3 + CloudFront; or Vercel as above.
7. **Secrets**: SSM → task definition; rotate webhook secret, `OPENAI_API_KEY`, DB credentials.
8. **Observability**: JSON logs → CloudWatch; `/health` for ALB checks.

## Auth (email + password)

Humans authenticate with **Supabase Auth email+password only** (no Google / social providers). Agents keep using `X-API-Key`.

### Runtime

1. SPA (`@supabase/supabase-js`) `signUp` / `signInWithPassword` against venlabs-demo.
2. Browser stores the session (PKCE) and sends `Authorization: Bearer <access_token>` on REST, uploads, and SSE.
3. Fastify `preHandler` passes the token to `resolveSession` (`packages/core`).
4. The API verifies the JWT (HS256 `SUPABASE_JWT_SECRET`, or JWKS at `SUPABASE_URL/auth/v1/.well-known/jwks.json`, or `GET /auth/v1/user` with the anon key).
5. `sub` + email map onto `users` / `memberships`. First signup with no membership creates a workspace, owner membership, default pipeline, and system agents. `X-Workspace-Slug` selects among workspaces the user already belongs to.

`ALLOW_DEV_WORKSPACE_AUTH` defaults **off** when `NODE_ENV=production`. Do not set it to `true` on Render. Local docker still uses slug fallback so `pnpm dev` works without Auth env.

### Env checklist

**Vercel (Production + Preview, build time)**

| Var | Value |
|---|---|
| `VITE_API_URL` | `https://copyr.onrender.com` |
| `VITE_SUPABASE_URL` | `https://cdsngnauduhiaidzncie.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Dashboard → **Project Settings → API** → legacy `anon` `public` JWT. Redeploy after setting. |
| `VITE_WORKSPACE_SLUG` | optional; `harbor-ventures` is only a hint |

Never set a service-role key on Vercel. Vite inlines `VITE_*` into the browser bundle.

**Render (API)**

| Var | Value |
|---|---|
| `DATABASE_URL` | existing session-pooler URL |
| `SUPABASE_URL` | `https://cdsngnauduhiaidzncie.supabase.co` |
| `SUPABASE_JWT_SECRET` | Dashboard → **Project Settings → API** → JWT Secret (server-only) |
| `SUPABASE_ANON_KEY` | same page, legacy anon JWT (fallback verifier; not required if JWT secret is set) |
| `ALLOW_DEV_WORKSPACE_AUTH` | `false` |
| `WEB_URL` | `https://copyr.vercel.app` |
| `PUBLIC_URL` | `https://copyr.onrender.com` |

### Dashboard steps (venlabs-demo)

Authentication → **URL Configuration**:

- **Site URL:** `https://copyr.vercel.app`
- **Redirect URLs:** `https://copyr.vercel.app/**`, `https://copyr.vercel.app/auth/callback`, `http://localhost:5173/**`, `http://localhost:5173/auth/callback`, `http://127.0.0.1:5173/**`

Authentication → **Providers → Email**: leave **Confirm email** enabled (sign-up will ask the user to check their inbox). For a faster demo, turn Confirm email **off** so `signUp` returns a session immediately.

Do **not** enable Google (or any social provider). The SPA has no Google buttons.

Row Level Security on `public` VentureLabs tables stays as-is (enabled, no anon policies). The API uses the `postgres` role via `DATABASE_URL`, not PostgREST.

---
