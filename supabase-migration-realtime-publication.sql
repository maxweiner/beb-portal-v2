-- ============================================================
-- Realtime publication — ensure all tables the app watches are
-- broadcasting change events to subscribed clients.
--
-- Run in Supabase SQL Editor. Each ALTER will error if the table
-- is already in the publication (that's expected and harmless),
-- so run them one at a time OR use the DO block below which
-- swallows the duplicate-table error.
-- ============================================================

DO $$
DECLARE
  tbl text;
  wanted text[] := ARRAY[
    'event_days',
    'buyer_entries',
    'buyer_checks',
    'events',
    'stores',
    'users',
    'shipments'
  ];
BEGIN
  FOREACH tbl IN ARRAY wanted LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
      RAISE NOTICE 'added % to supabase_realtime', tbl;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '% already in supabase_realtime (ok)', tbl;
    END;
  END LOOP;
END $$;

-- Verify current publication membership
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
