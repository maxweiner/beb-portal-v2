-- ============================================================
-- Backfill all phone columns to raw 10-digit format.
-- The app now formats for display via lib/phone.ts; storing the raw
-- digits keeps data uniform regardless of how it was entered.
-- Strips non-digits, drops a leading "1" if present (US country code).
-- ============================================================

CREATE OR REPLACE FUNCTION beb_normalize_phone(input text) RETURNS text AS $$
DECLARE
  digits text;
BEGIN
  IF input IS NULL OR input = '' THEN RETURN input; END IF;
  digits := REGEXP_REPLACE(input, '\D', '', 'g');
  IF LENGTH(digits) = 11 AND LEFT(digits, 1) = '1' THEN
    digits := SUBSTRING(digits FROM 2);
  END IF;
  RETURN digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE users
   SET phone = beb_normalize_phone(phone)
 WHERE phone IS NOT NULL AND phone IS DISTINCT FROM beb_normalize_phone(phone);

UPDATE stores
   SET owner_phone = beb_normalize_phone(owner_phone)
 WHERE owner_phone IS NOT NULL AND owner_phone IS DISTINCT FROM beb_normalize_phone(owner_phone);

UPDATE store_employees
   SET phone = beb_normalize_phone(phone)
 WHERE phone IS NOT NULL AND phone IS DISTINCT FROM beb_normalize_phone(phone);

UPDATE appointments
   SET customer_phone = beb_normalize_phone(customer_phone)
 WHERE customer_phone IS NOT NULL AND customer_phone IS DISTINCT FROM beb_normalize_phone(customer_phone);

DROP FUNCTION beb_normalize_phone(text);
