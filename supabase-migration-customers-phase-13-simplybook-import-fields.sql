-- ============================================================
-- Customers module — PHASE 13: SimplyBook.me import provenance
--
-- Adds two columns so the historical SimplyBook.me client list
-- can be imported as a labeled batch — letting us audit, query,
-- or roll back the import as a unit.
--
-- The cleaned source file (Customers.xlsx) is 5 columns —
-- name, email, telephone, creation date, store — all of which
-- map to existing customers columns. The only new state we
-- need to capture is "where did this row come from".
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS import_source   TEXT NULL,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID NULL;

-- Scope rollback / audit queries to a single batch without
-- table-scanning customers.
CREATE INDEX IF NOT EXISTS customers_import_batch_id_idx
  ON customers (import_batch_id)
  WHERE import_batch_id IS NOT NULL;
