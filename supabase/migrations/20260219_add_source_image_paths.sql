-- Store the storage paths of source images used to create the orthomosaic
-- so they can be reused later for raw-image plant detection
ALTER TABLE orthomosaics
  ADD COLUMN IF NOT EXISTS source_image_paths JSONB;
