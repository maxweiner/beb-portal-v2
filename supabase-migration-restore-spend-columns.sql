-- ============================================================
-- Restore the legacy events.spend_vdp / spend_newspaper /
-- spend_postcard columns. Pairs with the code revert in PR #61
-- onward (full undo of the marketing rebuild on the spend side).
--
-- Backfill strategy: sum marketing_payments.amount per event,
-- grouped by type label. Matches the original PR A migration
-- direction in reverse — anything that was migrated in is
-- migrated back out.
--
-- spend_spiffs is untouched (it never left).
-- marketing_payments rows are LEFT IN PLACE in case you want
-- to reference / drop them later — they're harmless.
--
-- Safe to re-run.
-- ============================================================

-- 1. Add columns back (default 0 so non-null math keeps working)
ALTER TABLE events ADD COLUMN IF NOT EXISTS spend_vdp        NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS spend_newspaper  NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS spend_postcard   NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- 2. Backfill from marketing_payments, summing by type
DO $$
DECLARE
  type_vdp UUID;
  type_news UUID;
  type_post UUID;
  touched INT;
BEGIN
  SELECT id INTO type_vdp  FROM marketing_payment_types WHERE label = 'VDP'            LIMIT 1;
  SELECT id INTO type_news FROM marketing_payment_types WHERE label = 'Newspaper'      LIMIT 1;
  SELECT id INTO type_post FROM marketing_payment_types WHERE label = 'Small Postcard' LIMIT 1;

  WITH sums AS (
    SELECT
      event_id,
      COALESCE(SUM(amount) FILTER (WHERE type_id = type_vdp),  0) AS vdp,
      COALESCE(SUM(amount) FILTER (WHERE type_id = type_news), 0) AS news,
      COALESCE(SUM(amount) FILTER (WHERE type_id = type_post), 0) AS post
    FROM marketing_payments
    GROUP BY event_id
  )
  UPDATE events e SET
    spend_vdp       = sums.vdp,
    spend_newspaper = sums.news,
    spend_postcard  = sums.post
  FROM sums
  WHERE sums.event_id = e.id;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'Backfilled spend_vdp / spend_newspaper / spend_postcard on % event(s).', touched;
END $$;
