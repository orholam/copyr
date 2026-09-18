# Copyr — deployment

> **The Fastify API must be a separate host. Do not put it on Vercel.**
> Vercel serves only the Vite SPA (`apps/web`). The API needs a long-running
> process (SSE, 100MB uploads, pg-boss workers). Use Render / Fly / Railway
> (`Dockerfile.api`, `render.yaml`). Without that host, the marketing site still
> deploys; `/app` API calls will 404.

## Ship now (Vercel SPA)

**Recommended mode (Hobby GitHub import):** Root Directory **empty** + repo-root
`vercel.json`. Do not set Root Directory to `apps/web` unless you cannot use that
mode. Two configs used to fight the Vite dashboard default (`outputDirectory: dist`).

1. Import **https://github.com/orholam/copyr** on Vercel (Hobby is fine for GitHub).
   VenLabs Origin-only accounts: [`docs/ORIGIN.md`](ORIGIN.md).
2. **Root Directory: leave empty** (repo root). Uses root `vercel.json`:
   - `installCommand`: `corepack enable && pnpm install --frozen-lockfile=false`
   - `buildCommand`: `pnpm --filter @copyr/web build`
   - `outputDirectory`: `dist`. After Vite writes `apps/web/dist`, the web build
     also writes `dist` and `.vercel/output` at the repo root **and under every
     `apps/*` folder**, because VenLabs/Hobby Turbo imports often collect output
     from a non-web Root Directory.
3. Framework: **Vite** (`vercel.json`). Repo-root `./dist` is **not** gitignored;
   a gitignored Output Directory looks empty to Vercel even after the mirror step.
4. If the import wizard filled Root Directory `apps/web`, **clear it** and redeploy.
5. Vercel env (Production + Preview, **build** time):

```bash
VITE_API_URL=https://<your-api-host>
VITE_WORKSPACE_SLUG=harbor-ventures
```

`VITE_API_URL` can wait until the API is up. Redeploy the SPA after setting it (Vite inlines it).

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

Then: `pnpm db:migrate` (renames a non-Copyr `public.deals` scaffold instead of dropping it) and optional `pnpm db:seed`.

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

Also on the API host: `PUBLIC_URL=https://<api-host>`, `WEB_URL=https://<vercel-host>`, `CORS_ALLOW_VERCEL_PREVIEWS=true`, `AUTO_MIGRATE=true`, `DEV_WORKSPACE_SLUG=harbor-ventures`.

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

Auth remains `X-API-Key` / `X-Workspace-Slug` / `DEV_WORKSPACE_SLUG` until
Supabase Auth lands (`resolveSession` is the swap point).

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
2. If `public.deals` exists **without** Copyr columns (`workspace_id`, `pipeline_id`, `stage_id`), rename it to `deals_scaffold` (or `deals_scaffold_N`) and rename colliding `deals_*` constraints/indexes. Rows are kept.
3. Apply Drizzle migrations from `packages/db/drizzle`.
4. `ENABLE ROW LEVEL SECURITY` on public tables with no policies, so the Supabase anon key cannot read Copyr tables via PostgREST. The API uses the `postgres` role (`BYPASSRLS`).

On Render, `AUTO_MIGRATE=true` (set in `render.yaml`) runs the same migrate on API boot.

Local docker-compose is unchanged: `pnpm db:up` then `pnpm db:migrate` against `localhost:5433`.

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
| `AUTO_MIGRATE` | `true` on Render |
| `DEV_WORKSPACE_SLUG` | `harbor-ventures` after seed |
| `AI_PROVIDER` | `mock` for a free demo; `openai` + `OPENAI_API_KEY` for real LLMs |
| `INBOUND_WEBHOOK_SECRET` | rotate from the `.env.example` default |

Health check: `GET /health`.

Fly.io: `fly launch --dockerfile Dockerfile.api` and set the same env. Railway: new service from `Dockerfile.api`.

Optional MCP HTTP: `Dockerfile.mcp` with `pnpm --filter @copyr/mcp dev` / `src/http.ts` on port 4200. Not required for the web demo.

### Web (Vercel)

**API is not on Vercel.** Use **one** mode:

| Mode | Root Directory | Config | Output Vercel looks for |
|---|---|---|---|
| **Recommended** | *empty* (repo root) | `vercel.json` | `dist` (mirrored from `apps/web/dist`) |
| Fallback | `apps/web` | `apps/web/vercel.json` | `dist` (Vite `outDir`, relative to `apps/web`) |

The fallback is only for an import that already locked Root Directory to
`apps/web`. It installs/builds with `pnpm --dir ../..` (no `cd`, so the shell
cwd stays `apps/web`). `@copyr/web` needs workspace packages under `packages/`,
so Vercel must include files outside the Root Directory (default on current
projects). Prefer clearing Root Directory instead.

1. Import `orholam/copyr` in Vercel.
2. Root Directory: **empty**.
3. Build-time env: `VITE_API_URL`, `VITE_WORKSPACE_SLUG` (see Ship now above).

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
| `DEV_WORKSPACE_SLUG` | harbor-ventures | *(remove once Supabase auth lands)* |

1. **Network**: VPC with private subnets for ECS + RDS; NAT or VPC endpoints for ECR/S3.
2. **Data**: RDS Postgres 16 Multi-AZ; run `pnpm --filter @copyr/db migrate` as a one-off ECS task.
3. **Storage**: S3 bucket, block public access, CORS for the web origin; presigned URLs already used by core.
4. **Email**: SES receive set → S3 → Lambda POST to `/api/v1/webhooks/inbound-email?secret=…` (idempotent per `messageId`).
5. **Compute**: API Fargate from `Dockerfile.api`; split workers with `API_RUN_WORKERS=false` if needed. MCP: `Dockerfile.mcp` at `/mcp*`.
6. **Web**: SPA `dist/` → S3 + CloudFront; or Vercel as above.
7. **Secrets**: SSM → task definition; rotate webhook secret, `OPENAI_API_KEY`, DB credentials.
8. **Observability**: JSON logs → CloudWatch; `/health` for ALB checks.

## Auth note

Today every request carries `X-API-Key` / `X-Workspace-Slug`. When Supabase Auth lands:

- issue Supabase JWTs to humans, keep API keys for agents,
- swap the single `resolveSession()` in `packages/core/src/services/workspace.ts`
  to validate JWTs (workspace membership lookup), and
- enforce row scoping exactly where it already is: every query filters `workspace_id`.
