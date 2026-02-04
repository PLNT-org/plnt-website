-- Migration: Add height mapping support for 3D tree/canopy height analysis
-- Run this in Supabase SQL Editor or via Supabase CLI

-- Add height mapping columns to orthomosaics table
ALTER TABLE orthomosaics
ADD COLUMN IF NOT EXISTS has_dsm BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS has_dtm BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS has_chm BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS processing_type TEXT DEFAULT 'orthomosaic';

-- Add constraint for processing_type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orthomosaics_processing_type_check'
  ) THEN
    ALTER TABLE orthomosaics
    ADD CONSTRAINT orthomosaics_processing_type_check
    CHECK (processing_type IN ('orthomosaic', 'height-mapping', '3d-model'));
  END IF;
END $$;

-- Add height statistics JSONB column for storing computed CHM data
-- Expected format: { stats: { minHeight, maxHeight, avgHeight, stdDev }, histogram: [...] }
ALTER TABLE orthomosaics
ADD COLUMN IF NOT EXISTS height_stats JSONB;

-- Add mission_type column to flight_plans table
ALTER TABLE flight_plans
ADD COLUMN IF NOT EXISTS mission_type TEXT DEFAULT 'orthomosaic';

-- Add constraint for mission_type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flight_plans_mission_type_check'
  ) THEN
    ALTER TABLE flight_plans
    ADD CONSTRAINT flight_plans_mission_type_check
    CHECK (mission_type IN ('orthomosaic', '3d-model', 'custom'));
  END IF;
END $$;

-- Note: The waypoints JSONB column structure is extended but doesn't require migration
-- New structure includes:
-- {
--   type: 'LineString',
--   coordinates: [[lng, lat], ...],
--   actions: ['photo', 'fly', ...],
--   gimbalPitches: [-90, -45, ...],  -- NEW: Per-waypoint gimbal angles
--   photoIntervalMeters: number,
--   estimatedPhotos: number,
--   missionType: 'orthomosaic' | '3d-model' | 'custom'  -- NEW
-- }

-- Create index for height data queries (faster filtering)
CREATE INDEX IF NOT EXISTS idx_orthomosaics_has_dsm
ON orthomosaics(has_dsm)
WHERE has_dsm = TRUE;

CREATE INDEX IF NOT EXISTS idx_orthomosaics_processing_type
ON orthomosaics(processing_type);

CREATE INDEX IF NOT EXISTS idx_flight_plans_mission_type
ON flight_plans(mission_type);

-- Add comment for documentation
COMMENT ON COLUMN orthomosaics.processing_type IS 'Type of processing: orthomosaic (2D), height-mapping (DSM/DTM), 3d-model';
COMMENT ON COLUMN orthomosaics.height_stats IS 'Computed CHM statistics: {stats: {minHeight, maxHeight, avgHeight, stdDev}, histogram: [...]}';
COMMENT ON COLUMN flight_plans.mission_type IS 'Flight pattern type: orthomosaic (single-grid), 3d-model (cross-hatch), custom';
