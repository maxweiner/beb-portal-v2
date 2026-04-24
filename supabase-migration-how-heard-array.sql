-- ============================================================
-- Convert appointments.how_heard from text to text[] so customers
-- can select multiple "How did you hear about us?" options on the
-- booking page (per spec §1).
--
-- Existing single-value rows become single-element arrays.
-- Empty / NULL values become empty arrays.
-- ============================================================

ALTER TABLE appointments
  ALTER COLUMN how_heard TYPE text[]
  USING CASE
    WHEN how_heard IS NULL OR how_heard = '' THEN '{}'::text[]
    ELSE ARRAY[how_heard]
  END;
