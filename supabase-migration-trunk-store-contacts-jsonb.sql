-- ── Trunk-show stores: contacts JSONB list ──────────────────
-- Replaces the fixed contact_1/2/3 + email_1/2 columns with a
-- single JSONB array of { name, email, send_documents } entries.
-- Old columns stay in the schema for now (don't break the
-- import flow) — UI reads + writes the new array; the legacy
-- columns become dormant.
--
-- Each contact:
--   { "name": "Jane Smith", "email": "jane@…", "send_documents": true }
--
-- Backfill rules:
--   contact_1 + email_1 → row 1 (send_documents = email_1 present)
--   contact_2 + email_2 → row 2
--   contact_3           → row 3 (no email; send_documents=false)
--
-- Safe to re-run: backfill skips rows that already have a
-- non-empty contacts array.
-- ============================================================

ALTER TABLE public.trunk_show_stores
  ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.trunk_show_stores.contacts IS
  'Ordered list of contacts: [{ name, email, send_documents: boolean }]. Replaces the legacy contact_1..3 + email_1..2 columns.';

UPDATE public.trunk_show_stores
   SET contacts =
     (CASE WHEN contact_1 IS NOT NULL OR email_1 IS NOT NULL
       THEN jsonb_build_array(jsonb_build_object(
         'name',           COALESCE(contact_1, ''),
         'email',          email_1,
         'send_documents', email_1 IS NOT NULL
       ))
       ELSE '[]'::jsonb END)
     ||
     (CASE WHEN contact_2 IS NOT NULL OR email_2 IS NOT NULL
       THEN jsonb_build_array(jsonb_build_object(
         'name',           COALESCE(contact_2, ''),
         'email',          email_2,
         'send_documents', email_2 IS NOT NULL
       ))
       ELSE '[]'::jsonb END)
     ||
     (CASE WHEN contact_3 IS NOT NULL AND contact_3 <> ''
       THEN jsonb_build_array(jsonb_build_object(
         'name',           contact_3,
         'email',          NULL,
         'send_documents', false
       ))
       ELSE '[]'::jsonb END)
 WHERE contacts = '[]'::jsonb
   AND (contact_1 IS NOT NULL OR contact_2 IS NOT NULL OR contact_3 IS NOT NULL
        OR email_1 IS NOT NULL OR email_2 IS NOT NULL);

-- Re-derive primary_contact_email / _name from the new array so
-- the trunk-comms send pipeline picks the right recipient. The
-- "primary" is the first contact flagged send_documents=true; if
-- none is flagged, the first contact with an email; otherwise
-- leave whatever was there.
UPDATE public.trunk_show_stores ts
   SET primary_contact_email = c.email,
       primary_contact_name  = NULLIF(c.name, '')
  FROM (
    SELECT id,
           (SELECT (elem->>'email')::text
              FROM jsonb_array_elements(contacts) elem
             WHERE (elem->>'send_documents')::boolean IS TRUE
               AND (elem->>'email') IS NOT NULL
             LIMIT 1) AS email,
           (SELECT (elem->>'name')::text
              FROM jsonb_array_elements(contacts) elem
             WHERE (elem->>'send_documents')::boolean IS TRUE
               AND (elem->>'email') IS NOT NULL
             LIMIT 1) AS name
      FROM public.trunk_show_stores
     WHERE jsonb_array_length(contacts) > 0
  ) c
 WHERE ts.id = c.id
   AND c.email IS NOT NULL
   AND (ts.primary_contact_email IS NULL OR ts.primary_contact_email <> c.email);

DO $$ BEGIN
  RAISE NOTICE 'trunk_show_stores.contacts JSONB column installed + backfilled.';
END $$;
