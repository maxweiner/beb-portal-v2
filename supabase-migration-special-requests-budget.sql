-- Add an optional budget to trunk-show special requests so the
-- requesting rep can flag the dollar amount they're asking for
-- (extra silver bags, security guard, etc.). Nullable — many
-- requests don't have a price tag.
ALTER TABLE public.trunk_show_special_requests
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2);

COMMENT ON COLUMN public.trunk_show_special_requests.budget IS
  'Optional dollar budget for the request. NULL when none specified.';
