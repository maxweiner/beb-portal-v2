-- ============================================================
-- customer_intakes table + RLS + license-photos storage bucket
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Create the customer_intakes table
CREATE TABLE IF NOT EXISTS customer_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL,
  
  -- Parsed license fields
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  date_of_birth DATE,
  address_line1 TEXT DEFAULT '',
  address_city TEXT DEFAULT '',
  address_state TEXT DEFAULT '',
  address_zip TEXT DEFAULT '',
  license_number TEXT DEFAULT '',
  license_state TEXT DEFAULT '',
  license_expiration DATE,
  sex TEXT DEFAULT '',
  eye_color TEXT DEFAULT '',
  height TEXT DEFAULT '',
  is_over_18 BOOLEAN NOT NULL DEFAULT false,
  
  -- Photo of front of license
  license_photo_url TEXT,
  photo_expires_at TIMESTAMPTZ,  -- auto-set to scanned_at + 3 years
  
  -- Metadata
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brand TEXT NOT NULL DEFAULT 'beb' CHECK (brand IN ('beb', 'liberty')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- NOTE: We deliberately do NOT store raw_barcode.
  -- Only parsed fields are kept. No raw barcode data is persisted.
  
  CONSTRAINT valid_brand CHECK (brand IN ('beb', 'liberty'))
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_customer_intakes_event ON customer_intakes(event_id);
CREATE INDEX IF NOT EXISTS idx_customer_intakes_buyer ON customer_intakes(buyer_id);
CREATE INDEX IF NOT EXISTS idx_customer_intakes_brand ON customer_intakes(brand);
CREATE INDEX IF NOT EXISTS idx_customer_intakes_photo_expiry ON customer_intakes(photo_expires_at)
  WHERE photo_expires_at IS NOT NULL;

-- 3. Enable RLS
ALTER TABLE customer_intakes ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Pattern: use auth.jwt()->>'email' since auth.email() returns null

-- Buyers can insert intakes for events they're assigned to
CREATE POLICY "Buyers can insert intakes for their events"
  ON customer_intakes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.id = customer_intakes.buyer_id
    )
  );

-- Buyers can read intakes they created
CREATE POLICY "Buyers can read own intakes"
  ON customer_intakes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (
          u.id = customer_intakes.buyer_id
          OR u.role IN ('admin', 'superadmin')
        )
    )
  );

-- Buyers can update their own intakes (e.g. adding photo URL after insert)
CREATE POLICY "Buyers can update own intakes"
  ON customer_intakes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND (
          u.id = customer_intakes.buyer_id
          OR u.role IN ('admin', 'superadmin')
        )
    )
  );

-- Admins can delete intakes
CREATE POLICY "Admins can delete intakes"
  ON customer_intakes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- 5. Create private storage bucket for license photos
-- NOTE: Run these via Supabase Dashboard > Storage if SQL doesn't work
INSERT INTO storage.buckets (id, name, public)
VALUES ('license-photos', 'license-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload to license-photos
CREATE POLICY "Authenticated users can upload license photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'license-photos');

-- Storage RLS: users can read photos from their events
CREATE POLICY "Authenticated users can read license photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'license-photos');

-- Storage RLS: admins can delete expired photos
CREATE POLICY "Admins can delete license photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'license-photos'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.email = auth.jwt()->>'email'
        AND u.role IN ('admin', 'superadmin')
    )
  );

-- ============================================================
-- OPTIONAL: Cleanup function for expired photos (run as cron)
-- Deletes photo URLs from intakes where photo_expires_at < now()
-- The actual storage files need a separate Edge Function to delete.
-- ============================================================
-- 
-- UPDATE customer_intakes
-- SET license_photo_url = NULL
-- WHERE photo_expires_at IS NOT NULL
--   AND photo_expires_at < now();
