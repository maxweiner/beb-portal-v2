-- ============================================================
-- Adds per-(role × module) read-only flag.
--
-- Today's grants are all read+write. This adds a `can_write` boolean
-- defaulting to TRUE, so existing behavior is preserved. Setting it
-- to FALSE on a row marks that role as having READ access to the
-- module (page renders, sidebar item shows) but no WRITE access.
--
-- Hook (useRoleModules) returns canWrite(moduleId) so consumers can
-- gate Save buttons / form inputs. Pages that don't yet consume
-- canWrite() continue to behave as before — equivalent to full
-- write access.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE role_modules
  ADD COLUMN IF NOT EXISTS can_write BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN role_modules.can_write IS
  'TRUE = role can read + edit the module; FALSE = read-only (sidebar item visible, page renders, but writes are disabled). Default TRUE preserves grants made before this column existed.';

DO $$ BEGIN
  RAISE NOTICE 'role_modules.can_write installed (default TRUE for existing rows).';
END $$;
