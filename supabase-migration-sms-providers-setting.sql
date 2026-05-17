-- Seeds the sms_providers + telnyx rows in the settings table.
-- Idempotent: re-running it won't overwrite an operator's saved
-- credentials, only fills in defaults the first time.

INSERT INTO settings (key, value)
VALUES (
  'sms_providers',
  jsonb_build_object(
    'internal',  'twilio',
    'marketing', 'twilio'
  )
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES (
  'telnyx',
  jsonb_build_object(
    'apiKey',             '',
    'publicKey',          '',
    'fromNumber',         '',
    'messagingProfileId', ''
  )
)
ON CONFLICT (key) DO NOTHING;
