-- Migration: Allow multiple active registrations of the same barcode/SKU.
-- Product barcodes are shared across many physical plants (one SKU = many pots),
-- so "one active registration per marker_code" is wrong for the field workflow:
-- each scan is its own plant at its own GPS location. Drop the uniqueness
-- guarantee; keep a plain index for lookups (idx_marker_reg_code already covers
-- (marker_code, is_active); add user_id lookup support in its place).

DROP INDEX IF EXISTS idx_marker_reg_active_code;

-- Preserve fast per-user lookups by marker_code (non-unique).
CREATE INDEX IF NOT EXISTS idx_marker_reg_user_code
  ON marker_registrations(user_id, marker_code)
  WHERE marker_code IS NOT NULL;
