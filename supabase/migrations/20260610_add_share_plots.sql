-- Viewer-drawn plots on a gated property share
-- ============================================================================
-- Anyone who clears a property_share's email gate can draw boundary plots on the
-- map and tag them with a block/bed number, container size (gallons), species,
-- and a readiness date. Plots persist per-share, so every viewer of the link
-- sees the same set, and the share owner can surface them in their dashboard.
--
-- All reads/writes go through service-role API routes gated by the share's
-- short-lived access token, so RLS is enabled with no policies (denies direct
-- anon/authenticated access by default), matching property_shares.

CREATE TABLE IF NOT EXISTS share_plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES property_shares(id) ON DELETE CASCADE,
  -- GeoJSON Polygon: { type: 'Polygon', coordinates: [[[lng,lat], ...]] }
  boundary JSONB NOT NULL,
  area_acres NUMERIC,
  -- Block / bed / plot number
  block INTEGER,
  -- Container size in gallons
  container_size NUMERIC,
  -- Free-text species name typed by the viewer
  species TEXT,
  -- When this plot's species is expected to be ready
  readiness_date DATE,
  -- Email of the viewer who drew it (from the cleared email gate, if known)
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_plots_share_id ON share_plots(share_id);

ALTER TABLE share_plots ENABLE ROW LEVEL SECURITY;
-- No policies: access is mediated entirely by service-role API routes.
