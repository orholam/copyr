# Copyr — AWS deployment guide

Target topology (all serverless-friendly, no exotic infra):

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

## Environment matrix

| Var | Local | Prod |
|---|---|---|
| `DATABASE_URL` | docker compose postgres | RDS cluster endpoint (IAM auth or Secrets Manager) |
| `STORAGE_ENDPOINT` | MinIO | *(unset — native S3)* |
| `STORAGE_BUCKET` | copyr-local | copyr-prod-<account> |
| `AI_PROVIDER` | mock | openai (or Bedrock-compatible gateway) |
| `INBOUND_WEBHOOK_SECRET` | dev value | Secrets Manager |
| `DEV_WORKSPACE_SLUG` | harbor-ventures | *(remove once Supabase auth lands)* |

## Steps

1. **Network**: VPC with private subnets for ECS + RDS; NAT or VPC endpoints for ECR/S3.
2. **Data**: RDS Postgres 16 Multi-AZ; run `pnpm --filter @copyr/db migrate` as a one-off ECS task.
3. **Storage**: S3 bucket, block public access, CORS for the web origin; presigned URLs already used by core.
4. **Email**:
   - SES receive set: route `*@yourdomain` → S3 bucket → Lambda that POSTs the normalized payload
     (`InboundEmailPayload` shape from `@copyr/contracts`) to `POST /api/v1/webhooks/inbound-email?secret=…`.
   - The webhook is idempotent per `messageId`, so SES retries are safe.
5. **Compute**:
   - API service: 1+ Fargate tasks from `Dockerfile.api`. Scale on ALB requests; workers run in-process
     (`JOB_CONCURRENCY`). For heavier throughput split into an api-only task (`API_RUN_WORKERS=false`)
     and a dedicated worker task running the same image with a worker entrypoint.
   - MCP service: `Dockerfile.mcp` http variant behind the same ALB at `/mcp*` (header-based auth).
6. **Web**: build SPA → upload `dist/` to S3 → CloudFront with SPA fallback; point `/api` and `/mcp`
   at the ALB (see `apps/web/nginx.conf` for header rules incl. SSE buffering off).
7. **Secrets**: SSM Parameter Store → task definition `secrets`; rotate `INBOUND_WEBHOOK_SECRET`,
   `OPENAI_API_KEY`, DB credentials via rotation lambda.
8. **Observability**: JSON logs → CloudWatch; add OTel later. `/health` for ALB checks.

## Auth note

Auth intentionally deferred to Supabase. Today every request carries `X-API-Key` /
`X-Workspace-Slug`. When Supabase lands:
- issue Supabase JWTs to humans, keep API keys for agents,
- swap the single `resolveSession()` in `packages/core/services/workspace.ts`
  to validate JWTs (workspace membership lookup), and
- enforce row scoping exactly where it already is: every query filters `workspace_id`.
