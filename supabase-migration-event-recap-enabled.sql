-- ============================================================
-- Flips the event-recap row's send_implemented flag now that the
-- /api/event-recap/send route + the per-event picker in the editor
-- are wired up. The Send button shows "coming soon" without this.
-- ============================================================

UPDATE report_templates
   SET send_implemented = true,
       updated_at = now()
 WHERE id = 'event-recap';
