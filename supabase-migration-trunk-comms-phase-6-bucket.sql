-- ── Trunk Comms phase 6: communication-pdfs storage bucket ──
-- Stores rendered letter PDFs at communications/{send_id}.pdf.
-- Private — uploads + reads happen exclusively via the service
-- role from the send + preview API routes. Authenticated users
-- access the PDFs through signed URLs minted server-side
-- (phase 7 wires that into the per-trunk-show comms tab).
--
-- Safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('communication-pdfs', 'communication-pdfs', false, 10485760)  -- 10MB cap
ON CONFLICT (id) DO NOTHING;

-- No storage.objects policies needed — service role bypasses RLS
-- and that's the only writer / reader of this bucket today.

DO $$ BEGIN
  RAISE NOTICE 'communication-pdfs bucket installed (private, 10MB cap).';
END $$;
