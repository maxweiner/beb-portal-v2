-- ============================================================
-- SMS notifications: per-user opt-in flag on users table.
-- Run this in the Supabase SQL Editor.
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_sms boolean DEFAULT false;

COMMENT ON COLUMN users.notify_sms
  IS 'If true, user receives SMS notifications (requires a phone number set).';
