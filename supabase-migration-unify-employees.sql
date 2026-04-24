-- ============================================================
-- Unify employees: appointment_employees → store_employees
--
-- We originally created appointment_employees because the existing
-- store_employees table held different data (per the user's earlier
-- direction). That has been re-clarified: store_employees IS the
-- canonical store-staff table, and the parallel appointment_employees
-- list is redundant.
--
-- This migration:
--   1. Ensures store_employees has the columns the appointment system
--      needs (active flag — phone/email already exist).
--   2. Copies every appointment_employees row into store_employees,
--      preserving the row id so existing appointments.appointment_employee_id
--      and qr_codes.appointment_employee_id references continue to resolve.
--   3. Re-points the foreign keys from appointment_employees → store_employees.
--   4. Drops appointment_employees.
--
-- Note: the column name `appointment_employee_id` on appointments and
-- qr_codes stays as-is to avoid touching every query — it now references
-- store_employees(id) instead.
-- ============================================================

-- 1. Ensure store_employees has the required columns
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_store_employees_active
  ON store_employees(store_id) WHERE active = true;

-- 2. Copy data, preserving IDs. Backfill phone/email as empty if absent.
INSERT INTO store_employees (id, store_id, name, active, created_at, phone, email)
SELECT id, store_id, name, active, created_at, '', ''
FROM appointment_employees
ON CONFLICT (id) DO NOTHING;

-- 3. Re-point FKs
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_appointment_employee_id_fkey;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_appointment_employee_id_fkey
  FOREIGN KEY (appointment_employee_id) REFERENCES store_employees(id) ON DELETE SET NULL;

ALTER TABLE qr_codes
  DROP CONSTRAINT IF EXISTS qr_codes_appointment_employee_id_fkey;
ALTER TABLE qr_codes
  ADD CONSTRAINT qr_codes_appointment_employee_id_fkey
  FOREIGN KEY (appointment_employee_id) REFERENCES store_employees(id) ON DELETE SET NULL;

-- 4. Drop the redundant table (cascades policies + indexes that hung off it)
DROP TABLE IF EXISTS appointment_employees;
