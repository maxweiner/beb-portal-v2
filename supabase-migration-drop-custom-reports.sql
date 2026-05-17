-- Drops Custom Reports v2 tables.
--
-- The Custom Reports v2 builder (SQL-style report definitions stored
-- in custom_reports.config, per-user pins in custom_report_pins) was
-- replaced by the AI Reports tab on 2026-05-17. No code references
-- either table after the same-day PR that ships this migration.
--
-- If anyone needs to recover saved Custom Reports v2 configs later,
-- they're still in the daily Supabase backups for 30 days.

drop table if exists custom_report_pins cascade;
drop table if exists custom_reports cascade;
