ALTER TABLE "activities" DROP CONSTRAINT IF EXISTS "activities_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "extractions" DROP CONSTRAINT IF EXISTS "extractions_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "research_reports" DROP CONSTRAINT IF EXISTS "research_reports_scope_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "spaces" DROP CONSTRAINT IF EXISTS "spaces_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "vaults" DROP CONSTRAINT IF EXISTS "vaults_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pipeline_id" uuid;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "stage_id" uuid;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "round_stage" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ask_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "valuation" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "position" text DEFAULT 'a0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "next_step_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "source_ref" text;
--> statement-breakpoint
UPDATE "companies" AS c SET
  "pipeline_id" = d."pipeline_id",
  "stage_id" = d."stage_id",
  "owner_user_id" = d."owner_user_id",
  "round_stage" = d."round_stage",
  "ask_amount" = d."ask_amount",
  "valuation" = d."valuation",
  "priority" = d."priority",
  "position" = d."position",
  "next_step_at" = d."next_step_at",
  "archived_at" = d."archived_at",
  "source_ref" = COALESCE(c."source_ref", d."source_ref")
FROM (
  SELECT DISTINCT ON ("company_id") *
  FROM "deals"
  ORDER BY "company_id", "archived_at" NULLS FIRST, "updated_at" DESC
) AS d
WHERE c."id" = d."company_id" AND c."pipeline_id" IS NULL;
--> statement-breakpoint
UPDATE "companies" AS c SET
  "pipeline_id" = p."id",
  "stage_id" = s."id"
FROM "pipelines" AS p
JOIN LATERAL (
  SELECT "id" FROM "stages" WHERE "pipeline_id" = p."id" ORDER BY "position" LIMIT 1
) AS s ON true
WHERE c."pipeline_id" IS NULL
  AND p."workspace_id" = c."workspace_id"
  AND p."id" = (
    SELECT p2."id" FROM "pipelines" p2
    WHERE p2."workspace_id" = c."workspace_id"
    ORDER BY p2."is_default" DESC, p2."position"
    LIMIT 1
  );
--> statement-breakpoint
UPDATE "documents" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "notes" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "activities" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "extractions" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "vaults" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "agent_runs" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "spaces" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "tasks" AS t SET "deal_id" = d."company_id" FROM "deals" d WHERE t."deal_id" = d."id";
--> statement-breakpoint
UPDATE "research_reports" AS t SET "scope_deal_id" = d."company_id" FROM "deals" d WHERE t."scope_deal_id" = d."id";
--> statement-breakpoint
UPDATE "field_values" AS fv SET "entity_id" = d."company_id"
FROM "deals" d
WHERE fv."entity_type" = 'deal' AND fv."entity_id" = d."id";
--> statement-breakpoint
DELETE FROM "field_values" a
USING "field_values" b
WHERE a."entity_type" = 'deal' AND b."entity_type" = 'company'
  AND a."field_id" = b."field_id" AND a."entity_id" = b."entity_id";
--> statement-breakpoint
UPDATE "field_values" SET "entity_type" = 'company' WHERE "entity_type" = 'deal';
--> statement-breakpoint
UPDATE "custom_fields" SET "target" = 'company'
WHERE "target" = 'deal'
  AND NOT EXISTS (
    SELECT 1 FROM "custom_fields" c2
    WHERE c2."workspace_id" = "custom_fields"."workspace_id"
      AND c2."target" = 'company'
      AND c2."key" = "custom_fields"."key"
  );
--> statement-breakpoint
DELETE FROM "custom_fields" WHERE "target" = 'deal';
--> statement-breakpoint
ALTER TABLE "deals" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TABLE "deals" CASCADE;
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "pipeline_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "stage_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_scope_deal_id_companies_id_fk" FOREIGN KEY ("scope_deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_deal_id_companies_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_ws_pipeline_idx" ON "companies" USING btree ("workspace_id","pipeline_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_stage_idx" ON "companies" USING btree ("stage_id","position");
