-- ============================================================
-- Communication templates: AI-generation tracking
--
-- 2026-05-16: users can now draft new templates via the Claude API
-- (Haiku 4.5) from a freeform prompt + refine existing templates
-- the same way. To audit which templates came from AI and what
-- prompts produced them:
--   - created_by_ai BOOLEAN — TRUE when the row was first saved
--     out of the AI generation modal.
--   - ai_prompt TEXT — the most recent prompt the user typed to
--     create or refine. NULL for hand-authored templates. Replaced
--     each time the user re-generates via Refine.
--
-- Safe to re-run. Idempotent.
-- ============================================================

ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS created_by_ai BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_prompt TEXT NULL;

COMMENT ON COLUMN public.communication_templates.created_by_ai IS
  'TRUE when the template was first saved out of the AI generation modal (Settings → Templates → ✨ New with AI / ✨ Refine with AI). Audit signal only — does not change runtime behavior.';
COMMENT ON COLUMN public.communication_templates.ai_prompt IS
  'The most recent prompt the user typed to create or refine this template. Replaced on each Refine. NULL for hand-authored templates.';

DO $$ BEGIN
  RAISE NOTICE 'communication_templates AI-tracking columns installed (created_by_ai, ai_prompt). Safe to re-run.';
END $$;
