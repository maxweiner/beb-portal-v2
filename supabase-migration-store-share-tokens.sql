-- ============================================================
-- Store share tokens — one permanent URL per store
--
-- Replaces the per-event share-token model (event_share_tokens)
-- with a per-STORE token, plus an event picker on the public
-- dashboard page. Store owners now get one durable URL per store
-- instead of a fresh token each event.
--
-- Default-event picking rule (UI-side, lives in app/e/[token]):
--   1. The currently LIVE event for that store, if any
--   2. Else: an event that just ended within the past 24h (post-
--      event recap window), if any
--   3. Else: the soonest UPCOMING event
--   4. Else: "no active events" stub
--
-- Past events (ended >24h ago) are hidden from the picker per
-- user spec ("hide past").
--
-- Migration steps
-- ---------------
-- 1. Create `store_share_tokens` table mirroring event_share_tokens
--    but keyed by store_id, with one-active-per-store partial unique.
-- 2. Migrate existing un-revoked event_share_tokens into the new
--    table — for each store, keep the MOST RECENT event token and
--    re-use its `token` string so any URLs already in the wild stay
--    valid.
-- 3. Mark the migrated event_share_tokens rows as revoked
--    (reason='migrated to store-level') so the old endpoint stops
--    serving them.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. store_share_tokens table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_share_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  -- ~24-char URL-safe random string. App-minted.
  token           TEXT NOT NULL UNIQUE,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  -- Revocation: non-null = the URL is dead
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT,
  -- View tracking
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at  TIMESTAMPTZ,
  view_count      INTEGER NOT NULL DEFAULT 0,
  -- Last time we texted/emailed the URL to the store
  last_sent_at    TIMESTAMPTZ,
  last_sent_to    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active token per store. Rotation = revoke old + insert new.
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_share_tokens_one_active
  ON public.store_share_tokens (store_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_share_tokens_lookup
  ON public.store_share_tokens (token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_share_tokens_store_created
  ON public.store_share_tokens (store_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────
-- 2. RLS — reuse the tightened helpers
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.store_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_share_tokens_read ON public.store_share_tokens;
CREATE POLICY store_share_tokens_read
  ON public.store_share_tokens FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS store_share_tokens_write ON public.store_share_tokens;
CREATE POLICY store_share_tokens_write
  ON public.store_share_tokens FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );


-- ─────────────────────────────────────────────────────────────
-- 3. updated_at touch trigger
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regprocedure('public.wholesale_touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_store_share_tokens_touch ON public.store_share_tokens;
    CREATE TRIGGER trg_store_share_tokens_touch
      BEFORE UPDATE ON public.store_share_tokens
      FOR EACH ROW EXECUTE FUNCTION public.wholesale_touch_updated_at();
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. Migrate existing event-level tokens → store-level
-- ─────────────────────────────────────────────────────────────
--
-- For each store with one or more un-revoked event_share_tokens
-- rows, take the MOST RECENT one and create a matching
-- store_share_tokens row (reusing the same `token` string so any
-- URL already shared stays valid). Skip stores that already have
-- an active store-level token.
DO $$
DECLARE
  rec RECORD;
  migrated INT := 0;
BEGIN
  IF to_regclass('public.event_share_tokens') IS NULL THEN
    RAISE NOTICE 'No event_share_tokens table — skipping migration.';
    RETURN;
  END IF;

  FOR rec IN
    -- Most recent un-revoked event-share token per store
    SELECT DISTINCT ON (e.store_id)
      e.store_id,
      est.token,
      est.created_by,
      est.created_by_email,
      est.first_viewed_at,
      est.last_viewed_at,
      est.view_count,
      est.last_sent_at,
      est.last_sent_to,
      est.created_at
    FROM public.event_share_tokens est
    JOIN public.events e ON e.id = est.event_id
    WHERE est.revoked_at IS NULL
    ORDER BY e.store_id, est.created_at DESC
  LOOP
    -- Skip if this store already has an active store-level token.
    IF EXISTS (
      SELECT 1 FROM public.store_share_tokens
      WHERE store_id = rec.store_id AND revoked_at IS NULL
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.store_share_tokens (
        store_id, token, created_by, created_by_email,
        first_viewed_at, last_viewed_at, view_count,
        last_sent_at, last_sent_to, created_at
      ) VALUES (
        rec.store_id, rec.token, rec.created_by, rec.created_by_email,
        rec.first_viewed_at, rec.last_viewed_at, COALESCE(rec.view_count, 0),
        rec.last_sent_at, rec.last_sent_to, rec.created_at
      );
      migrated := migrated + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Token already exists on store_share_tokens (re-run). Skip.
      NULL;
    END;
  END LOOP;

  RAISE NOTICE 'Migrated % event-level token(s) into store_share_tokens.', migrated;

  -- Mark every still-active event_share_token revoked so the old
  -- per-event endpoint stops serving them. The app code is being
  -- switched to look up tokens in store_share_tokens.
  UPDATE public.event_share_tokens
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_reason = COALESCE(revoked_reason, 'migrated to store-level token')
   WHERE revoked_at IS NULL;
END $$;


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'store_share_tokens ready. Existing per-event URLs that were migrated will keep working at /e/[token]; new tokens are store-level. event_share_tokens table is retained for audit but all rows are now revoked.';
END $$;
