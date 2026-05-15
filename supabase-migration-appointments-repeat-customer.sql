-- ============================================================
-- Appointments — repeat-customer detection
--
-- When a customer (or staff member) books an appointment we now
-- check the per-store customers DB by normalized phone. If we
-- match an existing customer:
--   1. The appointment row is flagged is_repeat_customer = TRUE
--      and linked back via repeat_customer_id.
--   2. The how_heard array gets "Repeat Customer" appended so it
--      shows up in attribution reports alongside the originating
--      channel (e.g. "Small Postcard" + "Repeat Customer").
--   3. The booking form autofills the customer name from the
--      stored record — phone-first UX.
--
-- The flag lives on appointments (rather than re-deriving on
-- every render) so the calendar / list views can render the
-- 🔁 Repeat chip with zero extra joins.
--
-- Backfills existing rows by joining appointments → customers
-- on (store_id, phone_normalized). Idempotent. Safe to re-run.
-- ============================================================

-- 1. Columns
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_repeat_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS repeat_customer_id UUID NULL
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_repeat_customer
  ON public.appointments(repeat_customer_id)
  WHERE repeat_customer_id IS NOT NULL;

COMMENT ON COLUMN public.appointments.is_repeat_customer IS
  'TRUE when the booking phone matched an existing customer in this store at insert time. Server-set in /api/appointments POST; never set by the client.';
COMMENT ON COLUMN public.appointments.repeat_customer_id IS
  'FK to the matched customer record when is_repeat_customer is TRUE. Lets the UI link from an appointment back to the customer profile.';

-- 2. Backfill — match appointments to customers by digits-only phone.
-- customers.phone_normalized is already 10-digit (see lib/customers/csv.ts).
-- Appointments store the raw entered phone in customer_phone, so strip
-- non-digits + leading '1' inline.
UPDATE public.appointments a
   SET is_repeat_customer = TRUE,
       repeat_customer_id = c.id
  FROM public.customers c
 WHERE a.repeat_customer_id IS NULL
   AND a.store_id = c.store_id
   AND c.phone_normalized IS NOT NULL
   AND c.phone_normalized = (
     CASE
       WHEN length(regexp_replace(a.customer_phone, '\D', '', 'g')) = 11
            AND left(regexp_replace(a.customer_phone, '\D', '', 'g'), 1) = '1'
         THEN right(regexp_replace(a.customer_phone, '\D', '', 'g'), 10)
       WHEN length(regexp_replace(a.customer_phone, '\D', '', 'g')) = 10
         THEN regexp_replace(a.customer_phone, '\D', '', 'g')
       ELSE NULL
     END
   );

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.appointments
   WHERE is_repeat_customer = TRUE;
  RAISE NOTICE 'is_repeat_customer + repeat_customer_id installed. % appointment(s) flagged as repeat after backfill.', v_count;
END $$;
