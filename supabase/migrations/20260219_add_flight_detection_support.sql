-- Add detection tracking columns to flight_images
ALTER TABLE flight_images
  ADD COLUMN IF NOT EXISTS detection_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS detection_count INT DEFAULT 0;
