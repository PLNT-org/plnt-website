-- Migration: Support barcode-based marker registration (no ArUco required)
-- Field workflow now scans plant barcodes (arbitrary text/SKUs) instead of ArUco
-- markers. The marker is identified by `marker_code` (the scanned barcode) when
-- present; legacy ArUco registrations continue to use `aruco_marker_id`.

-- ArUco ID is no longer mandatory (barcode-only registrations have none).
ALTER TABLE marker_registrations
  ALTER COLUMN aruco_marker_id DROP NOT NULL;

-- Scanned barcode/SKU identifying the marker (arbitrary text).
ALTER TABLE marker_registrations
  ADD COLUMN IF NOT EXISTS marker_code TEXT;

COMMENT ON COLUMN marker_registrations.marker_code IS
  'Scanned barcode/SKU identifying the marker (replaces ArUco for barcode-only workflow)';

-- One active registration per marker_code per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marker_reg_active_code
  ON marker_registrations(user_id, marker_code)
  WHERE is_active = TRUE AND marker_code IS NOT NULL;

-- Lookup by marker_code.
CREATE INDEX IF NOT EXISTS idx_marker_reg_code
  ON marker_registrations(marker_code, is_active)
  WHERE marker_code IS NOT NULL;

-- Every registration must still identify a marker by at least one of the two.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marker_reg_identity_check'
  ) THEN
    ALTER TABLE marker_registrations
      ADD CONSTRAINT marker_reg_identity_check
      CHECK (aruco_marker_id IS NOT NULL OR marker_code IS NOT NULL);
  END IF;
END $$;
