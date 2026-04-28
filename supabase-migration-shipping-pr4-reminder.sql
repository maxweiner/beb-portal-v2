-- ============================================================
-- Store Shipping PR 4: ship-day reminder email.
--
-- Reuses the v2 scheduled_notifications + dispatcher pipeline.
--
-- Adds:
--   - One notification_templates row per brand for trigger_type
--     'shipping_reminder' (with the friendly default body).
--   - Trigger on event_shipments INSERT: enqueue one
--     scheduled_notifications row per current store recipient at
--     ship_date 08:00 store-local (default America/New_York if the
--     store has no timezone set).
--   - Trigger on event_shipments UPDATE of ship_date:
--     cancel pending reminders and re-enqueue at the new time.
--   - Trigger on event_shipments UPDATE of status='cancelled':
--     cancel pending reminders.
--   - Trigger on stores UPDATE of shipping_recipients: for each
--     in-flight shipment whose ship_date is still in the future,
--     reconcile pending reminders against the new recipient list.
--   - Backfill: enqueue reminders for any existing shipment that
--     doesn't have one yet and whose ship_date is in the future.
--
-- "No Hold" / "Hold at Home Office" stores: hold_time_days IS NULL,
-- so no shipment ever exists, so no reminders ever get enqueued.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Templates: one row per brand ──
INSERT INTO notification_templates (
  id, brand, trigger_type, channel, name, enabled, channels,
  delay_minutes, email_subject, email_body_html, email_body_text,
  sms_body, body, description,
  respect_quiet_hours_email, respect_quiet_hours_sms
) VALUES
  ('beb_shipping_reminder', 'beb', 'shipping_reminder', 'email',
   'Ship-day Reminder', true, ARRAY['email'], 0,
   '📦 Time to ship the {{store_name}} boxes today',
   '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a16">
     <h1 style="font-size:24px;margin:0 0 8px">📦 Ship day for {{store_name}}!</h1>
     <p style="color:#737368;margin:0 0 16px">It''s time to send the boxes back to BEB. 🚚</p>
     <div style="background:#fff8eb;border-left:4px solid #F59E0B;padding:12px 14px;border-radius:6px;margin:16px 0;font-size:14px">
       <strong>Today you''re shipping:</strong><br/>
       📦 {{jewelry_count}} Jewelry boxes ({{jewelry_label}})<br/>
       📦 {{silver_count}} Silver boxes ({{silver_label}})
     </div>
     <p style="margin:12px 0">
       <strong>Event:</strong> {{event_name}}<br/>
       <strong>Dates:</strong> {{event_dates}}<br/>
       <strong>Store:</strong> {{store_name}}<br/>
       <strong>Address:</strong> {{store_address}}
     </p>
     <p style="text-align:center;margin:24px 0">
       <a href="{{shipping_panel_url}}" style="display:inline-block;padding:12px 24px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">
         Open shipping panel ✈️
       </a>
     </p>
     <p style="color:#a8a89a;font-size:12px;text-align:center;margin-top:24px">
       BEB Buyer Portal · Ship-day Reminder
     </p>
   </div>',
   'Ship day for {{store_name}}! Today you''re shipping {{jewelry_count}} Jewelry boxes ({{jewelry_label}}) and {{silver_count}} Silver boxes ({{silver_label}}). Event: {{event_name}} · {{event_dates}}. Open the shipping panel: {{shipping_panel_url}}',
   '',
   'Ship day reminder — sent the morning of the ship date to all store shipping recipients.',
   'Sent the morning of the ship date to the store''s shipping recipients.',
   true, true),

  ('liberty_shipping_reminder', 'liberty', 'shipping_reminder', 'email',
   'Ship-day Reminder', true, ARRAY['email'], 0,
   '📦 Time to ship the {{store_name}} boxes today',
   '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a16">
     <h1 style="font-size:24px;margin:0 0 8px">📦 Ship day for {{store_name}}!</h1>
     <p style="color:#737368;margin:0 0 16px">It''s time to send the boxes back. 🚚</p>
     <div style="background:#fff8eb;border-left:4px solid #F59E0B;padding:12px 14px;border-radius:6px;margin:16px 0;font-size:14px">
       <strong>Today you''re shipping:</strong><br/>
       📦 {{jewelry_count}} Jewelry boxes ({{jewelry_label}})<br/>
       📦 {{silver_count}} Silver boxes ({{silver_label}})
     </div>
     <p style="margin:12px 0">
       <strong>Event:</strong> {{event_name}}<br/>
       <strong>Dates:</strong> {{event_dates}}<br/>
       <strong>Store:</strong> {{store_name}}<br/>
       <strong>Address:</strong> {{store_address}}
     </p>
     <p style="text-align:center;margin:24px 0">
       <a href="{{shipping_panel_url}}" style="display:inline-block;padding:12px 24px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">
         Open shipping panel ✈️
       </a>
     </p>
     <p style="color:#a8a89a;font-size:12px;text-align:center;margin-top:24px">
       Liberty Buyer Portal · Ship-day Reminder
     </p>
   </div>',
   'Ship day for {{store_name}}! Today you''re shipping {{jewelry_count}} Jewelry boxes ({{jewelry_label}}) and {{silver_count}} Silver boxes ({{silver_label}}). Event: {{event_name}} · {{event_dates}}. Open the shipping panel: {{shipping_panel_url}}',
   '',
   'Ship day reminder — sent the morning of the ship date to all store shipping recipients.',
   'Sent the morning of the ship date to the store''s shipping recipients.',
   true, true)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Helper: build the merge_data JSONB + scheduled_for + brand
-- for a given shipment, used by enqueue + reconcile paths. ──
CREATE OR REPLACE FUNCTION shipment_reminder_payload(p_shipment_id UUID)
RETURNS TABLE (
  brand TEXT,
  template_id TEXT,
  scheduled_for TIMESTAMPTZ,
  merge_data JSONB,
  recipients TEXT[]
) AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT
    es.id, es.event_id, es.store_id, es.ship_date,
    es.jewelry_box_count, es.silver_box_count,
    e.brand, e.start_date, e.store_name AS event_store_name,
    st.name AS store_name, st.address, st.city, st.state, st.zip,
    COALESCE(st.timezone, 'America/New_York') AS tz,
    st.shipping_recipients
  INTO s
  FROM event_shipments es
  JOIN events e ON e.id = es.event_id
  JOIN stores st ON st.id = es.store_id
  WHERE es.id = p_shipment_id;

  IF NOT FOUND THEN RETURN; END IF;

  brand := s.brand;
  template_id := CASE s.brand WHEN 'beb' THEN 'beb_shipping_reminder' ELSE 'liberty_shipping_reminder' END;
  -- 8 AM in the store's local timezone, converted to UTC
  scheduled_for := (s.ship_date::text || ' 08:00:00')::timestamp AT TIME ZONE s.tz;
  merge_data := jsonb_build_object(
    'store_name', s.store_name,
    'event_name', s.event_store_name || ' — ' || to_char(s.start_date, 'Mon DD, YYYY'),
    'event_dates', to_char(s.start_date, 'Mon DD') || ' – ' || to_char(s.start_date + 2, 'Mon DD, YYYY'),
    'store_address', concat_ws(', ',
      NULLIF(s.address, ''), NULLIF(s.city, ''),
      concat_ws(' ', NULLIF(s.state, ''), NULLIF(s.zip, ''))
    ),
    'ship_date', to_char(s.ship_date, 'FMDay, FMMonth FMDD, YYYY'),
    'jewelry_count', s.jewelry_box_count::text,
    'jewelry_label', CASE WHEN s.jewelry_box_count = 0 THEN '—'
                          WHEN s.jewelry_box_count = 1 THEN 'J1'
                          ELSE 'J1–J' || s.jewelry_box_count END,
    'silver_count', s.silver_box_count::text,
    'silver_label', CASE WHEN s.silver_box_count = 0 THEN '—'
                         WHEN s.silver_box_count = 1 THEN 'S1'
                         ELSE 'S1–S' || s.silver_box_count END,
    'shipping_panel_url',
      COALESCE(current_setting('app.public_base_url', true), 'https://beb-portal-v2.vercel.app')
      || '/?event=' || s.event_id::text
  );
  recipients := COALESCE(s.shipping_recipients, '{}');

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Enqueue function ──
CREATE OR REPLACE FUNCTION enqueue_shipping_reminders(p_shipment_id UUID)
RETURNS VOID AS $$
DECLARE
  p RECORD;
  email TEXT;
BEGIN
  FOR p IN SELECT * FROM shipment_reminder_payload(p_shipment_id) LOOP
    -- skip if ship date already passed
    IF p.scheduled_for <= now() - INTERVAL '12 hours' THEN RETURN; END IF;

    FOREACH email IN ARRAY p.recipients LOOP
      -- Skip if a pending row already exists for this (event, email)
      IF EXISTS (
        SELECT 1 FROM scheduled_notifications sn
        WHERE sn.trigger_type = 'shipping_reminder'
          AND sn.related_event_id = (SELECT event_id FROM event_shipments WHERE id = p_shipment_id)
          AND sn.recipient_email = email
          AND sn.status IN ('pending','held','processing')
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO scheduled_notifications (
        brand, trigger_type, template_id,
        recipient_email, channels, merge_data,
        scheduled_for, related_event_id
      ) VALUES (
        p.brand, 'shipping_reminder', p.template_id,
        email, ARRAY['email'], p.merge_data,
        p.scheduled_for,
        (SELECT event_id FROM event_shipments WHERE id = p_shipment_id)
      );
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. Cancel pending reminders for a shipment ──
CREATE OR REPLACE FUNCTION cancel_shipping_reminders(p_event_id UUID, p_reason TEXT DEFAULT 'shipment_change')
RETURNS VOID AS $$
BEGIN
  UPDATE scheduled_notifications
    SET status = 'cancelled',
        cancelled_reason = p_reason,
        updated_at = now()
    WHERE trigger_type = 'shipping_reminder'
      AND related_event_id = p_event_id
      AND status IN ('pending','held');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 5. Triggers on event_shipments ──
CREATE OR REPLACE FUNCTION trg_enqueue_shipment_reminders()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM enqueue_shipping_reminders(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_event_shipments_enqueue_reminders ON event_shipments;
CREATE TRIGGER trg_event_shipments_enqueue_reminders
AFTER INSERT ON event_shipments
FOR EACH ROW EXECUTE FUNCTION trg_enqueue_shipment_reminders();

CREATE OR REPLACE FUNCTION trg_resync_shipment_reminders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    PERFORM cancel_shipping_reminders(NEW.event_id, 'shipment_cancelled');
    RETURN NEW;
  END IF;

  IF NEW.ship_date IS DISTINCT FROM OLD.ship_date THEN
    PERFORM cancel_shipping_reminders(NEW.event_id, 'ship_date_changed');
    PERFORM enqueue_shipping_reminders(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_event_shipments_resync_reminders ON event_shipments;
CREATE TRIGGER trg_event_shipments_resync_reminders
AFTER UPDATE OF ship_date, status ON event_shipments
FOR EACH ROW EXECUTE FUNCTION trg_resync_shipment_reminders();

-- ── 6. Trigger on stores: recipient list change ──
CREATE OR REPLACE FUNCTION trg_resync_store_shipping_recipients()
RETURNS TRIGGER AS $$
DECLARE
  s RECORD;
BEGIN
  IF NEW.shipping_recipients IS NOT DISTINCT FROM OLD.shipping_recipients THEN
    RETURN NEW;
  END IF;

  -- For each in-flight shipment with future ship_date, reconcile.
  FOR s IN
    SELECT es.id, es.event_id
    FROM event_shipments es
    WHERE es.store_id = NEW.id
      AND es.status NOT IN ('complete','cancelled')
      AND es.ship_date >= CURRENT_DATE
  LOOP
    -- Cancel rows whose email is no longer in the new list
    UPDATE scheduled_notifications
      SET status = 'cancelled',
          cancelled_reason = 'recipient_removed',
          updated_at = now()
      WHERE trigger_type = 'shipping_reminder'
        AND related_event_id = s.event_id
        AND status IN ('pending','held')
        AND NOT (recipient_email = ANY(NEW.shipping_recipients));
    -- Add rows for emails that don't have a pending one
    PERFORM enqueue_shipping_reminders(s.id);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_stores_resync_shipping_recipients ON stores;
CREATE TRIGGER trg_stores_resync_shipping_recipients
AFTER UPDATE OF shipping_recipients ON stores
FOR EACH ROW EXECUTE FUNCTION trg_resync_store_shipping_recipients();

-- ── 7. One-time backfill ──
DO $$
DECLARE
  s RECORD;
  enqueued INT := 0;
BEGIN
  FOR s IN
    SELECT es.id FROM event_shipments es
    WHERE es.status NOT IN ('complete','cancelled')
      AND es.ship_date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notifications sn
        WHERE sn.trigger_type = 'shipping_reminder'
          AND sn.related_event_id = es.event_id
          AND sn.status IN ('pending','held','processing','sent')
      )
  LOOP
    PERFORM enqueue_shipping_reminders(s.id);
    enqueued := enqueued + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled reminders for % shipment(s).', enqueued;
END $$;
