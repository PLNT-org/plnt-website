-- Migration: Add ArUco marker detection support for plot identification
-- Run this in Supabase SQL Editor or via Supabase CLI

-- ============================================
-- 1. Create aruco_markers table
-- ============================================

CREATE TABLE IF NOT EXISTS aruco_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orthomosaic_id UUID REFERENCES orthomosaics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ArUco identification
  marker_id INTEGER NOT NULL,  -- 0-999 for DICT_7X7_1000
  dictionary TEXT DEFAULT 'DICT_7X7_1000',

  -- Georeferenced position (WGS84)
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,

  -- Pixel position in orthomosaic (for debugging/verification)
  pixel_x INTEGER,
  pixel_y INTEGER,

  -- Detection metadata
  confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
  corner_pixels JSONB,  -- [[x,y], [x,y], [x,y], [x,y]] for precise bounds
  corner_coords JSONB,  -- [[lat,lng], ...] georeferenced corners
  rotation_deg FLOAT,   -- Marker rotation in image

  -- Verification status
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one active marker per ID per orthomosaic
CREATE UNIQUE INDEX IF NOT EXISTS idx_aruco_markers_unique
ON aruco_markers(orthomosaic_id, marker_id);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_aruco_markers_orthomosaic
ON aruco_markers(orthomosaic_id);

CREATE INDEX IF NOT EXISTS idx_aruco_markers_marker_id
ON aruco_markers(marker_id);

CREATE INDEX IF NOT EXISTS idx_aruco_markers_user
ON aruco_markers(user_id);

CREATE INDEX IF NOT EXISTS idx_aruco_markers_verified
ON aruco_markers(verified)
WHERE verified = FALSE;

-- ============================================
-- 2. Add ArUco detection columns to orthomosaics
-- ============================================

ALTER TABLE orthomosaics
ADD COLUMN IF NOT EXISTS aruco_detection_status TEXT DEFAULT 'pending';

-- Add constraint for aruco_detection_status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orthomosaics_aruco_detection_status_check'
  ) THEN
    ALTER TABLE orthomosaics
    ADD CONSTRAINT orthomosaics_aruco_detection_status_check
    CHECK (aruco_detection_status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END $$;

ALTER TABLE orthomosaics
ADD COLUMN IF NOT EXISTS aruco_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS aruco_detected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS aruco_error_message TEXT;

-- ============================================
-- 3. Row Level Security for aruco_markers
-- ============================================

ALTER TABLE aruco_markers ENABLE ROW LEVEL SECURITY;

-- Users can view markers on orthomosaics they own
CREATE POLICY "Users can view markers on own orthomosaics" ON aruco_markers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orthomosaics
      WHERE orthomosaics.id = aruco_markers.orthomosaic_id
      AND orthomosaics.user_id = auth.uid()
    )
  );

-- Users can insert markers on orthomosaics they own
CREATE POLICY "Users can insert markers on own orthomosaics" ON aruco_markers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM orthomosaics
      WHERE orthomosaics.id = aruco_markers.orthomosaic_id
      AND orthomosaics.user_id = auth.uid()
    )
  );

-- Users can update markers on orthomosaics they own
CREATE POLICY "Users can update markers on own orthomosaics" ON aruco_markers
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM orthomosaics
      WHERE orthomosaics.id = aruco_markers.orthomosaic_id
      AND orthomosaics.user_id = auth.uid()
    )
  );

-- Users can delete markers on orthomosaics they own
CREATE POLICY "Users can delete markers on own orthomosaics" ON aruco_markers
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM orthomosaics
      WHERE orthomosaics.id = aruco_markers.orthomosaic_id
      AND orthomosaics.user_id = auth.uid()
    )
  );

-- ============================================
-- 4. Trigger for updated_at
-- ============================================

-- Reuse existing trigger function if it exists, otherwise create
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_aruco_markers_updated_at
  BEFORE UPDATE ON aruco_markers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. Documentation comments
-- ============================================

COMMENT ON TABLE aruco_markers IS 'ArUco markers detected in orthomosaic images for plot identification';
COMMENT ON COLUMN aruco_markers.marker_id IS 'ArUco marker ID (0-999 for DICT_7X7_1000 dictionary)';
COMMENT ON COLUMN aruco_markers.dictionary IS 'OpenCV ArUco dictionary used for detection';
COMMENT ON COLUMN aruco_markers.latitude IS 'Marker center latitude (WGS84)';
COMMENT ON COLUMN aruco_markers.longitude IS 'Marker center longitude (WGS84)';
COMMENT ON COLUMN aruco_markers.corner_pixels IS 'Four corner pixel coordinates [[x,y], ...]';
COMMENT ON COLUMN aruco_markers.corner_coords IS 'Four corner geographic coordinates [[lat,lng], ...]';
COMMENT ON COLUMN aruco_markers.confidence IS 'Detection confidence score (0-1)';
COMMENT ON COLUMN aruco_markers.rotation_deg IS 'Marker rotation angle in degrees';
COMMENT ON COLUMN orthomosaics.aruco_detection_status IS 'Status of ArUco detection: pending, processing, completed, failed';
COMMENT ON COLUMN orthomosaics.aruco_count IS 'Number of ArUco markers detected in this orthomosaic';
COMMENT ON COLUMN orthomosaics.aruco_detected_at IS 'Timestamp when ArUco detection completed';
