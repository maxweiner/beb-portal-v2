-- ============================================================
-- Final cleanup of the marketing rebuild. Drops the three tables
-- introduced by PR #52:
--
--   - marketing_payments
--   - marketing_payment_methods
--   - marketing_payment_types
--
-- Run AFTER supabase-migration-restore-spend-columns.sql so the
-- backfill into events.spend_* has happened first. Once these
-- tables are gone the data is unrecoverable.
--
-- DROP order matches FK direction: payments first (it references
-- the two lookups), then the lookups.
-- ============================================================

DROP TABLE IF EXISTS marketing_payments;
DROP TABLE IF EXISTS marketing_payment_methods;
DROP TABLE IF EXISTS marketing_payment_types;
