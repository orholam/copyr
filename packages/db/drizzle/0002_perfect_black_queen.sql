CREATE TYPE "public"."agent_kind" AS ENUM('thesis_screen', 'diligence_checklist', 'portfolio_monitor', 'custom');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('preference', 'focus_area', 'process', 'fact');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('declared', 'learned');--> statement-breakpoint
CREATE TYPE "public"."review_table_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."vault_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."credit_reason" ADD VALUE 'vault_review';--> statement-breakpoint
ALTER TYPE "public"."credit_reason" ADD VALUE 'research_report';--> statement-breakpoint
ALTER TYPE "public"."credit_reason" ADD VALUE 'agent_run';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'vault';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'review_table';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'agent';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'agent_run';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'space';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'task';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'memory';--> statement-breakpoint
ALTER TYPE "public"."activity_entity" ADD VALUE 'research_report';--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"trigger" varchar(24) DEFAULT 'manual' NOT NULL,
	"company_id" uuid,
	"deal_id" uuid,
	"space_id" uuid,
	"task_id" uuid,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT 'null'::jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "agent_kind" DEFAULT 'custom' NOT NULL,
	"description" text,
	"instructions" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_cron" varchar(64),
	"next_run_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "memory_kind" DEFAULT 'preference' NOT NULL,
	"source" "memory_source" DEFAULT 'declared' NOT NULL,
	"content" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope_company_id" uuid,
	"scope_deal_id" uuid,
	"scope_vault_id" uuid,
	"model" text DEFAULT 'mock' NOT NULL,
	"confidence" numeric(3, 2),
	"credits_used" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_table_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid,
	"row_index" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric(3, 2),
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"name" text NOT NULL,
	"instruction" text,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_table_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "space_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"org" text,
	"role" varchar(16) DEFAULT 'viewer' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"company_id" uuid,
	"deal_id" uuid,
	"vault_id" uuid,
	"context_snapshot" jsonb DEFAULT 'null'::jsonb,
	"is_shared" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"space_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"title" text NOT NULL,
	"detail" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"assignee_agent_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"position" text DEFAULT 'a0' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"company_id" uuid,
	"deal_id" uuid,
	"status" "vault_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_scope_company_id_companies_id_fk" FOREIGN KEY ("scope_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_scope_deal_id_deals_id_fk" FOREIGN KEY ("scope_deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_scope_vault_id_vaults_id_fk" FOREIGN KEY ("scope_vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rows" ADD CONSTRAINT "review_rows_review_table_id_review_tables_id_fk" FOREIGN KEY ("review_table_id") REFERENCES "public"."review_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rows" ADD CONSTRAINT "review_rows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rows" ADD CONSTRAINT "review_rows_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tables" ADD CONSTRAINT "review_tables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tables" ADD CONSTRAINT "review_tables_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tables" ADD CONSTRAINT "review_tables_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_participants" ADD CONSTRAINT "space_participants_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_participants" ADD CONSTRAINT "space_participants_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_documents" ADD CONSTRAINT "vault_documents_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_documents" ADD CONSTRAINT "vault_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_status_idx" ON "agent_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_company_idx" ON "agent_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "agents_ws_idx" ON "agents" USING btree ("workspace_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_ws_name_idx" ON "agents" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "memories_ws_idx" ON "memories" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "research_reports_ws_idx" ON "research_reports" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "research_reports_company_idx" ON "research_reports" USING btree ("scope_company_id");--> statement-breakpoint
CREATE INDEX "review_rows_table_idx" ON "review_rows" USING btree ("review_table_id","row_index");--> statement-breakpoint
CREATE INDEX "review_rows_document_idx" ON "review_rows" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "review_tables_vault_idx" ON "review_tables" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "review_tables_ws_idx" ON "review_tables" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "space_participants_unique_idx" ON "space_participants" USING btree ("space_id","email");--> statement-breakpoint
CREATE INDEX "spaces_ws_idx" ON "spaces" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "spaces_deal_idx" ON "spaces" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "spaces_company_idx" ON "spaces" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "tasks_space_idx" ON "tasks" USING btree ("space_id","position");--> statement-breakpoint
CREATE INDEX "tasks_ws_status_idx" ON "tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_documents_unique_idx" ON "vault_documents" USING btree ("vault_id","document_id");--> statement-breakpoint
CREATE INDEX "vault_documents_doc_idx" ON "vault_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "vaults_ws_idx" ON "vaults" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "vaults_company_idx" ON "vaults" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "vaults_deal_idx" ON "vaults" USING btree ("deal_id");