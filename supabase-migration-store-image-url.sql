-- ============================================================
-- Adds the missing stores.store_image_url column. The existing
-- admin "Store Image" upload section in Stores.tsx writes to this
-- column, and the appointment booking page reads from it for the
-- store logo in the header. Without it, both silently fail.
-- ============================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_image_url TEXT;
