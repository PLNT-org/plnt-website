-- Migration: Raw barcode scan log.
-- Every successful decode is persisted immediately — full raw payload, format,
-- and best-effort GPS — regardless of whether the registration wizard is
-- completed. Nothing scanned in the field is ever lost.

CREATE TABLE IF NOT EXISTS barcode_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_value TEXT NOT NULL,
  format TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  gps_accuracy_meters DOUBLE PRECISION,
  source TEXT DEFAULT 'register-marker',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barcode_scans_user_time
  ON barcode_scans(user_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_value
  ON barcode_scans(raw_value);

-- API routes use the service role; lock the table down for everyone else.
ALTER TABLE barcode_scans ENABLE ROW LEVEL SECURITY;
