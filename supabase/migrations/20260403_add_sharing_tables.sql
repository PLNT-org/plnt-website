-- Sharing tables for admin-to-user orthomosaic sharing
-- =====================================================

-- Table: shared_orthomosaics
-- Tracks which orthomosaics have been shared with which users
CREATE TABLE IF NOT EXISTS shared_orthomosaics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orthomosaic_id UUID NOT NULL REFERENCES orthomosaics(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(orthomosaic_id, shared_with_user_id)
);

-- Index for fast lookups by shared user
CREATE INDEX idx_shared_orthomosaics_user ON shared_orthomosaics(shared_with_user_id);
CREATE INDEX idx_shared_orthomosaics_ortho ON shared_orthomosaics(orthomosaic_id);

-- RLS on shared_orthomosaics
ALTER TABLE shared_orthomosaics ENABLE ROW LEVEL SECURITY;

-- Users can see shares made to them
CREATE POLICY "Users can view their shared orthomosaics"
  ON shared_orthomosaics FOR SELECT
  USING (auth.uid() = shared_with_user_id);

-- Allow users to SELECT orthomosaics shared with them
CREATE POLICY "Users can view orthomosaics shared with them"
  ON orthomosaics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_orthomosaics
      WHERE shared_orthomosaics.orthomosaic_id = orthomosaics.id
        AND shared_orthomosaics.shared_with_user_id = auth.uid()
    )
  );

-- Allow users to view plant_labels on orthomosaics shared with them
CREATE POLICY "Users can view labels on shared orthomosaics"
  ON plant_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_orthomosaics
      WHERE shared_orthomosaics.orthomosaic_id = plant_labels.orthomosaic_id
        AND shared_orthomosaics.shared_with_user_id = auth.uid()
    )
  );
