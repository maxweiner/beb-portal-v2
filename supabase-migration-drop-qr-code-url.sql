-- ============================================================
-- Drop the legacy stores.qr_code_url column.
-- The "SimplyBook QR Code" upload UI has been removed; the new QR
-- system in §5 generates QRs server-side and tracks them in the
-- qr_codes table — there's no longer any reason to upload a static
-- QR image per store.
-- ============================================================

ALTER TABLE stores DROP COLUMN IF EXISTS qr_code_url;
