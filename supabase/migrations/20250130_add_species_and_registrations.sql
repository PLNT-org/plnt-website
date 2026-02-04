-- Migration: Add species and marker_registrations tables for Phase 1B
-- This enables mobile marker registration linking ArUco markers to plant species

-- ============================================
-- SPECIES TABLE
-- ============================================
-- Stores plant species information that can be linked to ArUco markers

CREATE TABLE IF NOT EXISTS species (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- Common name: "White Oak"
  scientific_name TEXT,                  -- Scientific name: "Quercus alba"
  barcode_value TEXT,                    -- Nursery's barcode for this species
  category TEXT,                         -- "Tree", "Shrub", "Perennial", etc.
  container_size TEXT,                   -- "1 gal", "5 gal", "15 gal", etc.
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for barcode lookup
CREATE INDEX idx_species_barcode ON species(user_id, barcode_value) WHERE barcode_value IS NOT NULL;

-- Index for searching by name
CREATE INDEX idx_species_name ON species(user_id, name);

-- ============================================
-- MARKER REGISTRATIONS TABLE
-- ============================================
-- Links ArUco markers to species with GPS coordinates for field registration

CREATE TABLE IF NOT EXISTS marker_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  aruco_marker_id INTEGER NOT NULL,      -- ArUco marker ID (0-999 for DICT_7X7_1000)
  aruco_dictionary TEXT DEFAULT 'DICT_7X7_1000',
  species_id UUID REFERENCES species(id) ON DELETE SET NULL,
  barcode_value TEXT,                    -- Raw barcode value (backup if species not found)
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  gps_accuracy_meters FLOAT,             -- GPS accuracy at time of registration
  plot_name TEXT,                        -- Optional label for the plot/area
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,        -- Only one active registration per marker
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one active registration per marker per user
CREATE UNIQUE INDEX idx_marker_reg_active
ON marker_registrations(user_id, aruco_marker_id)
WHERE is_active = TRUE;

-- Index for looking up by marker ID
CREATE INDEX idx_marker_reg_aruco ON marker_registrations(aruco_marker_id, is_active);

-- Index for spatial queries
CREATE INDEX idx_marker_reg_location ON marker_registrations(latitude, longitude);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE species ENABLE ROW LEVEL SECURITY;
ALTER TABLE marker_registrations ENABLE ROW LEVEL SECURITY;

-- Species RLS policies
CREATE POLICY "Users can view own species"
  ON species FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own species"
  ON species FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own species"
  ON species FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own species"
  ON species FOR DELETE
  USING (auth.uid() = user_id);

-- Marker registrations RLS policies
CREATE POLICY "Users can view own registrations"
  ON marker_registrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own registrations"
  ON marker_registrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own registrations"
  ON marker_registrations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own registrations"
  ON marker_registrations FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================

-- Trigger function (reuse if exists, create if not)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to species
DROP TRIGGER IF EXISTS update_species_updated_at ON species;
CREATE TRIGGER update_species_updated_at
    BEFORE UPDATE ON species
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply to marker_registrations
DROP TRIGGER IF EXISTS update_marker_registrations_updated_at ON marker_registrations;
CREATE TRIGGER update_marker_registrations_updated_at
    BEFORE UPDATE ON marker_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
