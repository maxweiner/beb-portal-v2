-- ============================================================
-- PR D: drop the legacy events.spend_vdp / spend_newspaper /
-- spend_postcard columns now that marketing_payments is the
-- system of record (PR A migrated all non-zero values).
--
-- spend_spiffs STAYS — spiffs are out of scope for the marketing
-- rebuild and continue to live on events.
--
-- Safe to re-run: IF EXISTS guards on each column.
-- ============================================================

ALTER TABLE events DROP COLUMN IF EXISTS spend_vdp;
ALTER TABLE events DROP COLUMN IF EXISTS spend_newspaper;
ALTER TABLE events DROP COLUMN IF EXISTS spend_postcard;
