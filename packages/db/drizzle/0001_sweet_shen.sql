ALTER TABLE "companies" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;