-- ============================================================
-- stores: default_form_number_visible
--
-- Drives the Form # column's initial visibility on the mobile Enter
-- Day Data screen. Per-user override is persisted in localStorage —
-- this column is just the per-store default.
--
-- Beneficial / default → TRUE  (Form # column shown)
-- Liberty             → FALSE (Form # column hidden by default)
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS default_form_number_visible BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN stores.default_form_number_visible
  IS 'Default visibility of the Form # column on the mobile Enter Day Data screen. Per-user override stored in localStorage at beb-form-no-{user_id}-{store_id}.';

-- Backfill: Liberty stores hide Form # by default.
UPDATE stores
   SET default_form_number_visible = FALSE
 WHERE brand = 'liberty'
   AND default_form_number_visible = TRUE;

DO $$
DECLARE n_hidden INT;
BEGIN
  SELECT COUNT(*) INTO n_hidden FROM stores WHERE default_form_number_visible = FALSE;
  RAISE NOTICE 'default_form_number_visible installed. Stores with Form # hidden by default: %', n_hidden;
END $$;
