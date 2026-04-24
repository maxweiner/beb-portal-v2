-- ============================================================
-- Appointment system: appointments + supporting tables
-- Run this in Supabase SQL Editor AFTER supabase-migration-store-booking-config.sql
--
-- Adds:
--   - event_booking_overrides (per-event hours / max-concurrent overrides)
--   - slot_blocks (admin/store-portal can block individual slots)
--   - appointments (the bookings themselves)
--   - notification_log (audit trail for SMS + email)
--   - hot_show_alerts (one-shot alert when an event crosses threshold)
-- ============================================================

-- 1. event_booking_overrides: optional per-event override of store defaults
CREATE TABLE IF NOT EXISTS event_booking_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,

  max_concurrent_slots INT,   -- null = inherit from booking_config
  day1_start TIME,
  day1_end   TIME,
  day2_start TIME,
  day2_end   TIME,
  day3_start TIME,
  day3_end   TIME,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_booking_overrides_event
  ON event_booking_overrides(event_id);

-- 2. slot_blocks: individual blocked time slots
CREATE TABLE IF NOT EXISTS slot_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  block_date DATE NOT NULL,
  block_time TIME NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT slot_blocks_unique_per_event_slot
    UNIQUE (event_id, block_date, block_time)
);

CREATE INDEX IF NOT EXISTS idx_slot_blocks_event_date
  ON slot_blocks(event_id, block_date);

-- 3. appointments: customer bookings
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  brand TEXT NOT NULL DEFAULT 'beb' CHECK (brand IN ('beb', 'liberty')),

  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,

  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,

  items_bringing TEXT[] NOT NULL DEFAULT '{}',
  how_heard TEXT,

  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),

  cancel_token UUID NOT NULL DEFAULT gen_random_uuid(),

  booked_by TEXT NOT NULL DEFAULT 'customer'
    CHECK (booked_by IN ('customer', 'store', 'admin')),

  appointment_employee_id UUID REFERENCES appointment_employees(id) ON DELETE SET NULL,
  is_walkin BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce unique cancel_token (used as the lookup key for cancel/reschedule URLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_cancel_token
  ON appointments(cancel_token);

-- Hot path: slot availability calc per event/day
CREATE INDEX IF NOT EXISTS idx_appointments_event_date_status
  ON appointments(event_id, appointment_date, status);

-- Store-portal upcoming list
CREATE INDEX IF NOT EXISTS idx_appointments_store_date
  ON appointments(store_id, appointment_date);

-- Spiff leaderboard
CREATE INDEX IF NOT EXISTS idx_appointments_employee
  ON appointments(appointment_employee_id) WHERE appointment_employee_id IS NOT NULL;

-- 4. notification_log: audit trail
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN (
    'sms_confirmation',
    'email_confirmation',
    'sms_reminder_24h',
    'sms_reminder_2h',
    'email_reminder_24h',
    'email_reminder_2h',
    'sms_cancellation',
    'email_cancellation',
    'sms_reschedule',
    'email_reschedule',
    'sms_hot_show_alert',
    'email_hot_show_alert'
  )),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'failed')),
  provider_id TEXT,           -- Twilio SID or Resend ID
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_log_appointment
  ON notification_log(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at
  ON notification_log(sent_at DESC);

-- 5. hot_show_alerts: one row per event once threshold is crossed
CREATE TABLE IF NOT EXISTS hot_show_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  threshold_pct INT NOT NULL,
  booked_pct INT NOT NULL,
  booked_count INT NOT NULL,
  total_slots INT NOT NULL,
  notified_via TEXT[] NOT NULL DEFAULT '{}',  -- subset of {'sms','email'}

  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. RLS — admin/superadmin only for direct authenticated access.
--    Customer booking page + store portal use API routes with service-role key.
ALTER TABLE event_booking_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hot_show_alerts         ENABLE ROW LEVEL SECURITY;

-- event_booking_overrides
CREATE POLICY "Admins manage event_booking_overrides"
  ON event_booking_overrides FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- slot_blocks
CREATE POLICY "Admins manage slot_blocks"
  ON slot_blocks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- appointments
CREATE POLICY "Admins manage appointments"
  ON appointments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- notification_log (admins read; writes happen via service role)
CREATE POLICY "Admins read notification_log"
  ON notification_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- hot_show_alerts (admins read; writes happen via service role)
CREATE POLICY "Admins read hot_show_alerts"
  ON hot_show_alerts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- 7. Auto-touch updated_at
CREATE OR REPLACE FUNCTION touch_event_booking_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_booking_overrides_updated_at ON event_booking_overrides;
CREATE TRIGGER trg_event_booking_overrides_updated_at
  BEFORE UPDATE ON event_booking_overrides
  FOR EACH ROW EXECUTE FUNCTION touch_event_booking_overrides_updated_at();

CREATE OR REPLACE FUNCTION touch_appointments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION touch_appointments_updated_at();
