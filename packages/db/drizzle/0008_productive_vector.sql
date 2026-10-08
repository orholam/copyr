DO $$ BEGIN
  CREATE TYPE "public"."participant_role" AS ENUM('submitter', 'upvote');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."syndicate_status" AS ENUM('queued', 'presented');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "participant_role" NOT NULL,
	"name" text NOT NULL,
	"firm" text,
	"email" text,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "round_label" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "firm_invested" boolean;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "syndicate_status" "syndicate_status";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal_participants" ADD CONSTRAINT "deal_participants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal_participants" ADD CONSTRAINT "deal_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_participants_company_idx" ON "deal_participants" USING btree ("company_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_participants_ws_idx" ON "deal_participants" USING btree ("workspace_id");
