-- Add reconstruction_data column to store compact OpenSfM camera model
-- Contains: reference_lla, cameras (intrinsics), shots (extrinsics)
-- ~20-30KB per orthomosaic for ~100 images. Nullable — existing rows unaffected.
ALTER TABLE orthomosaics
  ADD COLUMN IF NOT EXISTS reconstruction_data JSONB;
