-- Drop the `simply_username`, `quo_phone_number`, and `holds` columns
-- from trunk_show_stores. Came in from the import sheet but aren't
-- used anywhere in the app.
ALTER TABLE public.trunk_show_stores
  DROP COLUMN IF EXISTS simply_username,
  DROP COLUMN IF EXISTS quo_phone_number,
  DROP COLUMN IF EXISTS holds;
