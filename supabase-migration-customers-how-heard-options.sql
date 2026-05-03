-- ============================================================
-- Update customer_how_did_you_hear enum to the new option set:
--
--   Old: postcard, newspaper, word_of_mouth, walk_in,
--        online, referral, other
--   New: large_postcard, small_postcard, newspaper,
--        email, text, the_store_told_me
--
-- Migration of existing rows:
--   - 'postcard' is renamed to 'large_postcard' (existing rows
--     are preserved as Large Postcard).
--   - 'newspaper' stays.
--   - 'word_of_mouth' / 'walk_in' / 'online' / 'referral' /
--     'other' are removed. The previous value is copied into
--     how_did_you_hear_legacy (free-text column added in the
--     phase-1 schema for exactly this purpose) and the enum
--     column is cleared. For 'other' rows, the user-entered
--     how_did_you_hear_other_text is preferred over the literal
--     'other' string when populating the legacy column.
--
-- Run once.
-- ============================================================

BEGIN;

-- 1. Preserve removed values in the legacy free-text column.
--    COALESCE prevents overwriting legacy text already imported
--    from a prior CSV / SimplyBook source.
UPDATE customers
SET how_did_you_hear_legacy = COALESCE(
      how_did_you_hear_legacy,
      CASE
        WHEN how_did_you_hear::text = 'other'
             AND how_did_you_hear_other_text IS NOT NULL
          THEN how_did_you_hear_other_text
        ELSE how_did_you_hear::text
      END
    )
WHERE how_did_you_hear::text IN
  ('word_of_mouth', 'walk_in', 'online', 'referral', 'other');

-- 2. Move the existing enum out of the way so we can recreate
--    it with the new value set under the same name.
ALTER TYPE customer_how_did_you_hear
  RENAME TO customer_how_did_you_hear_old;

CREATE TYPE customer_how_did_you_hear AS ENUM (
  'large_postcard', 'small_postcard', 'newspaper',
  'email', 'text', 'the_store_told_me'
);

-- 3. Re-type the column. The USING expression renames
--    'postcard' → 'large_postcard' and clears any deprecated
--    value (whose original was just stashed into legacy above).
ALTER TABLE customers
  ALTER COLUMN how_did_you_hear TYPE customer_how_did_you_hear
  USING (
    CASE
      WHEN how_did_you_hear::text = 'postcard' THEN 'large_postcard'
      WHEN how_did_you_hear::text IN
        ('word_of_mouth', 'walk_in', 'online', 'referral', 'other')
        THEN NULL
      ELSE how_did_you_hear::text
    END
  )::customer_how_did_you_hear;

-- 4. Drop the old enum now that nothing references it.
DROP TYPE customer_how_did_you_hear_old;

COMMIT;
