-- Detection jobs table for async plant detection
CREATE TABLE IF NOT EXISTS detection_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orthomosaic_id UUID NOT NULL REFERENCES orthomosaics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'orthomosaic', -- 'orthomosaic', 'homography', 'flight'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'downloading', 'detecting', 'saving', 'completed', 'failed'
  progress JSONB DEFAULT '{}', -- {processedTiles, totalTiles, detectionsCount, currentImage, totalImages}
  result JSONB DEFAULT '{}', -- {totalDetections, savedCount, classCounts, averageConfidence}
  error_message TEXT,
  config JSONB DEFAULT '{}', -- {confidence_threshold, include_classes, tile_width, etc.}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for polling by orthomosaic
CREATE INDEX idx_detection_jobs_orthomosaic ON detection_jobs(orthomosaic_id);
-- Index for finding active jobs
CREATE INDEX idx_detection_jobs_status ON detection_jobs(status) WHERE status NOT IN ('completed', 'failed');

-- RLS policies
ALTER TABLE detection_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view their own jobs
CREATE POLICY "Users can view own detection jobs"
  ON detection_jobs FOR SELECT
  USING (user_id = auth.uid());

-- Service role can do everything (used by Docker service via REST API)
-- No policy needed — service role bypasses RLS
