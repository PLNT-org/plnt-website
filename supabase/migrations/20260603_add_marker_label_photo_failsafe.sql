-- Migration: Label-photo failsafe for marker registration
-- If a plant's barcode can't be scanned, the field worker takes a photo of the
-- label instead. The photo alone is enough to register the location (GPS); the
-- plant can be identified later from the photo.

-- Storage path of the uploaded label photo (in the marker-labels bucket).
ALTER TABLE marker_registrations
  ADD COLUMN IF NOT EXISTS label_photo_url TEXT;

COMMENT ON COLUMN marker_registrations.label_photo_url IS
  'Storage path of a label photo captured when the barcode could not be scanned';

-- A registration must identify the marker by at least one of: ArUco id,
-- scanned barcode, or a label photo. Replace the earlier 2-way check.
ALTER TABLE marker_registrations
  DROP CONSTRAINT IF EXISTS marker_reg_identity_check;

ALTER TABLE marker_registrations
  ADD CONSTRAINT marker_reg_identity_check
  CHECK (
    aruco_marker_id IS NOT NULL
    OR marker_code IS NOT NULL
    OR label_photo_url IS NOT NULL
  );

-- Private bucket for label photos. Accessed server-side via the service role,
-- so no public access or per-user storage policies are required.
INSERT INTO storage.buckets (id, name, public)
VALUES ('marker-labels', 'marker-labels', false)
ON CONFLICT (id) DO NOTHING;
