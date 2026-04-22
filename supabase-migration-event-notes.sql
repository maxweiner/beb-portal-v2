-- ============================================================
-- Event Notes — per-event journal entries buyers add to capture
-- what worked, what didn't, and ideas for next time.
-- Run this in the Supabase SQL Editor. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  user_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('worked', 'didnt_work', 'do_differently')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_notes_event ON event_notes(event_id);
CREATE INDEX IF NOT EXISTS idx_event_notes_store ON event_notes(store_id);

ALTER TABLE event_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON event_notes;
CREATE POLICY "Allow all for authenticated" ON event_notes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
