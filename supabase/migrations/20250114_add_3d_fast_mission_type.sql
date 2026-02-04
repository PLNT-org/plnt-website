-- Add '3d-fast' to the allowed mission_type values
-- 3D Fast mode: single-grid nadir + cross-hatch oblique (~25% faster than full 3D)

-- Drop the existing constraint
ALTER TABLE flight_plans
DROP CONSTRAINT IF EXISTS flight_plans_mission_type_check;

-- Add updated constraint with '3d-fast' option
ALTER TABLE flight_plans
ADD CONSTRAINT flight_plans_mission_type_check
CHECK (mission_type IN ('orthomosaic', '3d-model', '3d-fast', 'custom'));

-- Update comment
COMMENT ON COLUMN flight_plans.mission_type IS 'Flight pattern type: orthomosaic (single-grid), 3d-model (full cross-hatch), 3d-fast (optimized 3D), custom';
