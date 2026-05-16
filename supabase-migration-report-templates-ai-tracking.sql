-- ============================================================
-- Track AI-generated report_templates rows.
--
-- Parallel to supabase-migration-comm-templates-ai-tracking.sql,
-- which added the same two columns to communication_templates.
--
--   - created_by_ai BOOLEAN — TRUE the first time the row was
--     saved via the AI-generation modal. We only set this true
--     on the initial AI-driven save; subsequent manual edits do
--     not unset it (the template's lineage is "originated by AI").
--   - ai_prompt TEXT — the most recent prompt the operator typed
--     to produce the current template. Stored for audit + so the
--     "Refine with AI" modal can show what was last asked.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS created_by_ai BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_prompt TEXT NULL;

COMMENT ON COLUMN public.report_templates.created_by_ai IS
  'TRUE if this row was originally written by the AI generation modal. Manual edits do not unset.';
COMMENT ON COLUMN public.report_templates.ai_prompt IS
  'Most recent prompt typed by the operator when generating/refining this template via AI.';

DO $$
BEGIN
  RAISE NOTICE 'report_templates AI-tracking columns installed (created_by_ai, ai_prompt). Safe to re-run.';
END$$;
