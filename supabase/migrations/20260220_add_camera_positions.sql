-- Store corrected camera positions from ODM's bundle adjustment
-- Maps filename → {latitude, longitude, altitude} for each source image
-- Used during raw image detection for accurate GPS placement
ALTER TABLE orthomosaics
  ADD COLUMN IF NOT EXISTS camera_positions JSONB;
