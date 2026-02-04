-- Migration: Add orthomosaic and plant labeling support
-- Run this in Supabase SQL Editor or via: npx supabase db push

-- ============================================
-- ORTHOMOSAICS TABLE
-- Stores processed orthomosaic metadata and links to WebODM outputs
-- ============================================
CREATE TABLE IF NOT EXISTS orthomosaics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flight_id UUID REFERENCES flights(id) ON DELETE CASCADE,  -- NULL for direct uploads
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL allowed for direct uploads
    name TEXT NOT NULL,

    -- WebODM task tracking
    webodm_task_id TEXT,
    webodm_project_id TEXT,

    -- Orthomosaic output
    orthomosaic_url TEXT,  -- URL to GeoTIFF on WebODM server

    -- Georeferencing bounds (for displaying on map)
    bounds JSONB,  -- { north: float, south: float, east: float, west: float }

    -- Metadata
    resolution_cm FLOAT,  -- Ground sample distance in cm/pixel
    image_width INT,      -- Pixel dimensions
    image_height INT,

    -- Processing status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_orthomosaics_user_id ON orthomosaics(user_id);
CREATE INDEX IF NOT EXISTS idx_orthomosaics_flight_id ON orthomosaics(flight_id);
CREATE INDEX IF NOT EXISTS idx_orthomosaics_status ON orthomosaics(status);

-- ============================================
-- PLANT LABELS TABLE
-- Unified storage for manual labels and AI detections
-- ============================================
CREATE TABLE IF NOT EXISTS plant_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orthomosaic_id UUID NOT NULL REFERENCES orthomosaics(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Geographic coordinates (WGS84)
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Pixel coordinates on orthomosaic (for reference)
    pixel_x INT,
    pixel_y INT,

    -- Source of the label
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),

    -- For AI detections
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),

    -- Classification
    label TEXT DEFAULT 'plant',  -- e.g., 'plant', 'healthy', 'stressed', 'dead', 'weed'

    -- User notes
    notes TEXT,

    -- Verification status (for AI labels)
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_plant_labels_orthomosaic ON plant_labels(orthomosaic_id);
CREATE INDEX IF NOT EXISTS idx_plant_labels_source ON plant_labels(source);
CREATE INDEX IF NOT EXISTS idx_plant_labels_verified ON plant_labels(verified);
CREATE INDEX IF NOT EXISTS idx_plant_labels_label ON plant_labels(label);

-- Spatial index for coordinate-based queries (if PostGIS is enabled)
-- Uncomment if you have PostGIS extension:
-- CREATE INDEX IF NOT EXISTS idx_plant_labels_location ON plant_labels USING GIST (
--     ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
-- );

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on both tables
ALTER TABLE orthomosaics ENABLE ROW LEVEL SECURITY;
ALTER TABLE plant_labels ENABLE ROW LEVEL SECURITY;

-- Orthomosaics: Users can only access their own
CREATE POLICY "Users can view their own orthomosaics"
    ON orthomosaics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own orthomosaics"
    ON orthomosaics FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own orthomosaics"
    ON orthomosaics FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own orthomosaics"
    ON orthomosaics FOR DELETE
    USING (auth.uid() = user_id);

-- Plant Labels: Users can access labels on their orthomosaics
CREATE POLICY "Users can view labels on their orthomosaics"
    ON plant_labels FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM orthomosaics
            WHERE orthomosaics.id = plant_labels.orthomosaic_id
            AND orthomosaics.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert labels on their orthomosaics"
    ON plant_labels FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM orthomosaics
            WHERE orthomosaics.id = plant_labels.orthomosaic_id
            AND orthomosaics.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update labels on their orthomosaics"
    ON plant_labels FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM orthomosaics
            WHERE orthomosaics.id = plant_labels.orthomosaic_id
            AND orthomosaics.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete labels on their orthomosaics"
    ON plant_labels FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM orthomosaics
            WHERE orthomosaics.id = plant_labels.orthomosaic_id
            AND orthomosaics.user_id = auth.uid()
        )
    );

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_orthomosaics_updated_at
    BEFORE UPDATE ON orthomosaics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plant_labels_updated_at
    BEFORE UPDATE ON plant_labels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
