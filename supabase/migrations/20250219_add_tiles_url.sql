-- Add tiles_url column to store XYZ tile URL template for Leaflet TileLayer
ALTER TABLE orthomosaics
ADD COLUMN IF NOT EXISTS tiles_url TEXT;

COMMENT ON COLUMN orthomosaics.tiles_url IS 'URL template for XYZ tiles, e.g. https://xxx.supabase.co/.../orthomosaic-tiles/{orthoId}/{z}/{x}/{y}.png';
