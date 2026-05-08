-- ── Record Chat: threads attachable to any record ──────────
-- One thread = one external recipient × one underlying record
-- (record_kind + record_id polymorphic ref). Multiple internal
-- users can post into a thread. Replies via email or SMS land
-- here through inbound webhooks (Postmark + Twilio).
--
-- Cascade delete is handled per-record-type by a trigger. We
-- add one for travel_reservations now; future record types
-- (events, expense_reports, etc.) get their own trigger when
-- chat is adopted there.
--
-- Safe to re-run.
-- ============================================================

-- 1. chat_threads
CREATE TABLE IF NOT EXISTS public.chat_threads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic record reference.
  record_kind                 TEXT NOT NULL,
  record_id                   UUID NOT NULL,
  -- External recipient — usually a public.users row but we snapshot
  -- email + phone in case the user record changes/disappears.
  external_user_id            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  external_email              TEXT,
  external_phone              TEXT,
  -- Short (8-char) URL-safe token for reply routing. Email Reply-To
  -- carries it; outbound SMS prepends "[ref: TOKEN]".
  reply_token                 TEXT NOT NULL UNIQUE,
  subject                     TEXT,
  status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'closed')),
  created_by                  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_record       ON public.chat_threads(record_kind, record_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_external     ON public.chat_threads(external_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_reply_token  ON public.chat_threads(reply_token);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

-- Visibility: sender + external recipient + admins/superadmins see
-- everything; everyone else only sees threads where they've posted
-- a message (the "anyone with access to the underlying record"
-- rule is enforced at the page level — pages already gate the
-- record itself, so we only check posters here as a defense).
DROP POLICY IF EXISTS chat_threads_read ON public.chat_threads;
CREATE POLICY chat_threads_read ON public.chat_threads
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR external_user_id = public.get_effective_user_id()
    OR created_by       = public.get_effective_user_id()
    OR EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.thread_id = chat_threads.id
        AND m.sender_user_id = public.get_effective_user_id()
    )
  );


-- 2. chat_messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  -- Null = external recipient (Tom replied via email/SMS).
  -- Non-null = internal user posted from the portal.
  sender_user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Snapshotted display name so deleted users still attribute.
  sender_display_name TEXT NOT NULL,
  body                TEXT NOT NULL,
  -- How the message arrived.
  channel_in          TEXT NOT NULL DEFAULT 'web'
                        CHECK (channel_in IN ('web', 'email', 'sms', 'system')),
  -- Outbound channels we tried for this message.
  channels_out        TEXT[] NOT NULL DEFAULT '{}',
  -- Identifiers for matching delivery webhooks back to this row.
  email_message_id    TEXT,
  sms_sid             TEXT,
  -- Per-channel delivery status. Shape:
  --   { email: { status: 'sent'|'failed', error: '…' }, sms: {...} }
  delivery_status     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread     ON public.chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender     ON public.chat_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_email_id   ON public.chat_messages(email_message_id);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_read ON public.chat_messages;
CREATE POLICY chat_messages_read ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = chat_messages.thread_id
        AND (
             t.external_user_id = public.get_effective_user_id()
          OR t.created_by       = public.get_effective_user_id()
          OR EXISTS (
            SELECT 1 FROM public.chat_messages m2
            WHERE m2.thread_id = t.id
              AND m2.sender_user_id = public.get_effective_user_id()
          )
        )
    )
  );

-- All writes go through the API.

-- 3. chat_message_reads — last-read timestamp per (user, thread)
--    so the unread-count badge can compute new messages.
CREATE TABLE IF NOT EXISTS public.chat_message_reads (
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_id    UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_reads_select ON public.chat_message_reads;
CREATE POLICY chat_message_reads_select ON public.chat_message_reads
  FOR SELECT TO authenticated
  USING (user_id = public.get_effective_user_id());

DROP POLICY IF EXISTS chat_message_reads_upsert ON public.chat_message_reads;
CREATE POLICY chat_message_reads_upsert ON public.chat_message_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.get_effective_user_id());

DROP POLICY IF EXISTS chat_message_reads_update ON public.chat_message_reads;
CREATE POLICY chat_message_reads_update ON public.chat_message_reads
  FOR UPDATE TO authenticated
  USING (user_id = public.get_effective_user_id())
  WITH CHECK (user_id = public.get_effective_user_id());


-- 4. last_message_at touch trigger — keeps chat_threads fresh so
--    listings can sort by recency without a max() per row.
CREATE OR REPLACE FUNCTION public.chat_touch_thread_last_message() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.chat_threads
     SET last_message_at = NEW.created_at
   WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_touch_last_message ON public.chat_messages;
CREATE TRIGGER trg_chat_touch_last_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_touch_thread_last_message();


-- 5. Cascade delete: when a travel_reservations row is deleted,
--    drop its chat threads. Other record_kinds get their own
--    trigger when chat is adopted there (see how trigger pattern
--    repeats in this file).
CREATE OR REPLACE FUNCTION public.chat_cascade_delete_for_travel() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.chat_threads
   WHERE record_kind = 'travel_reservation' AND record_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_cascade_travel ON public.travel_reservations;
CREATE TRIGGER trg_chat_cascade_travel
  AFTER DELETE ON public.travel_reservations
  FOR EACH ROW EXECUTE FUNCTION public.chat_cascade_delete_for_travel();


DO $$ BEGIN
  RAISE NOTICE 'Chat tables installed: chat_threads, chat_messages, chat_message_reads. Cascade trigger active for travel_reservations.';
END $$;
