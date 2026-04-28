-- ============================================================
-- Shipping PR 5: carrier tracking integration (FedEx first; UPS to follow).
--
-- Adds normalized carrier-status fields to event_shipment_boxes so a
-- background poller can mirror the carrier's view of each tracked
-- shipment (in_transit / out_for_delivery / delivered / exception).
-- The existing manual status flow (pending → labels_sent → shipped →
-- received) keeps working — when the poller sees 'delivered' it
-- auto-advances the box to 'received' so the dashboards line up.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE event_shipment_boxes
  ADD COLUMN IF NOT EXISTS carrier_status TEXT
    CHECK (carrier_status IS NULL OR carrier_status IN
      ('unknown','label_created','in_transit','out_for_delivery','delivered','exception','returned')),
  ADD COLUMN IF NOT EXISTS carrier_status_detail TEXT,
  ADD COLUMN IF NOT EXISTS carrier_last_event TEXT,
  ADD COLUMN IF NOT EXISTS carrier_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_eta DATE,
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_poll_error TEXT;

-- Partial index for the poll job: only boxes with a tracking number that
-- aren't done yet are candidates for refresh.
CREATE INDEX IF NOT EXISTS idx_shipment_boxes_poll
  ON event_shipment_boxes (last_polled_at NULLS FIRST)
  WHERE tracking_number IS NOT NULL
    AND status NOT IN ('received', 'cancelled');

DO $$
BEGIN
  RAISE NOTICE 'Carrier-tracking columns installed on event_shipment_boxes.';
END $$;
