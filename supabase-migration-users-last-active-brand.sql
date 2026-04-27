-- ============================================================
-- Persist the user's last-active brand on their user record so
-- switching from Beneficial <-> Liberty on one device propagates
-- to other devices on next page load.
--
-- The app's current "store switcher" is actually a brand switcher
-- between 'beb' and 'liberty' — those are the values that control
-- which CSS theme + which scoped data is loaded.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_brand TEXT
    CHECK (last_active_brand IS NULL OR last_active_brand IN ('beb', 'liberty'));

-- RLS: users can update their own row's last_active_brand. There's already
-- a broader users policy in place; this just confirms the column is OK to
-- write. If your existing users RLS doesn't cover UPDATE for self, the
-- write below relies on the service-role client (which bypasses RLS) used
-- in the next API path. No new policy required.
