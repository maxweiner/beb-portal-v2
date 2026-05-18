-- Drop the legacy single-provider SMS credentials row.
--
-- Background: there used to be two SMS UIs writing to two settings rows:
--   - Admin → SMS Settings  → settings.key='sms'      (Twilio only)
--   - Settings → SMS Providers → settings.key='twilio' (+ 'telnyx', 'sms_providers')
-- The Admin tab has been removed; SMS Providers is now the only writer.
-- Drop the orphan row so it can't drift back into use.
--
-- Idempotent: harmless if the row was never created.

DELETE FROM public.settings WHERE key = 'sms';
