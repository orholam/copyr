-- Hotfix for venlabs-demo / Render Copyr when AUTO_MIGRATE did not run.
-- Unblocks GET /api/v1/analytics/overview and GET /api/v1/deals after the
-- company-deal merge (packages/db/drizzle/0007_dapper_chamber.sql).
--
-- Types match packages/db/src/schema.ts `companies`.
-- pipeline_id / stage_id stay NULLABLE here so existing rows do not fail.
-- 0007 later backfills from public.deals and sets those two NOT NULL.
--
-- Safe to re-run (IF NOT EXISTS). Does NOT drop public.deals.
-- Prefer `pnpm db:migrate` when DATABASE_URL can reach this database.

BEGIN;

-- ── columns the current API selects on companies ─────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pipeline_id uuid;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stage_id uuid;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS round_stage text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ask_amount numeric(14, 2);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS valuation numeric(14, 2);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0 NOT NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS position text DEFAULT 'a0' NOT NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS next_step_at timestamp with time zone;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS source_ref text;

-- ── indexes expected by schema.ts ────────────────────────────────────
CREATE INDEX IF NOT EXISTS companies_ws_pipeline_idx
  ON public.companies USING btree (workspace_id, pipeline_id);
CREATE INDEX IF NOT EXISTS companies_stage_idx
  ON public.companies USING btree (stage_id, position);

-- ── copy pipeline fields from deals when that table still exists ─────
DO $$
BEGIN
  IF to_regclass('public.deals') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'company_id'
     )
  THEN
    UPDATE public.companies AS c SET
      pipeline_id = d.pipeline_id,
      stage_id = d.stage_id,
      owner_user_id = d.owner_user_id,
      round_stage = d.round_stage,
      ask_amount = d.ask_amount,
      valuation = d.valuation,
      priority = d.priority,
      position = d.position,
      next_step_at = d.next_step_at,
      archived_at = d.archived_at,
      source_ref = COALESCE(c.source_ref, d.source_ref)
    FROM (
      SELECT DISTINCT ON (company_id) *
      FROM public.deals
      ORDER BY company_id, archived_at NULLS FIRST, updated_at DESC
    ) AS d
    WHERE c.id = d.company_id AND c.pipeline_id IS NULL;
  END IF;
END $$;

-- Default pipeline + first stage for companies still missing them.
UPDATE public.companies AS c SET
  pipeline_id = p.id,
  stage_id = s.id
FROM public.pipelines AS p
JOIN LATERAL (
  SELECT id FROM public.stages WHERE pipeline_id = p.id ORDER BY position LIMIT 1
) AS s ON true
WHERE c.pipeline_id IS NULL
  AND p.workspace_id = c.workspace_id
  AND p.id = (
    SELECT p2.id FROM public.pipelines p2
    WHERE p2.workspace_id = c.workspace_id
    ORDER BY p2.is_default DESC, p2.position
    LIMIT 1
  );

COMMIT;

-- Verify (run after the transaction):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'companies'
--   AND column_name IN (
--     'pipeline_id','stage_id','owner_user_id','round_stage','ask_amount',
--     'valuation','priority','position','next_step_at','archived_at','source_ref'
--   )
-- ORDER BY column_name;
