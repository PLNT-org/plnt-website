-- Counts as history, and work orders keyed to plots, on gated property shares
-- ============================================================================
-- 1. share_plots gains a stable bay reference so a plot keeps its identity when
--    its boundary is redrawn (e.g. QGIS bay "14-23" on the Boething share), and
--    the count method / confidence that PLNT publishes for it.
-- 2. share_plot_counts keeps every published count per plot per flight: the
--    client sees the latest published row, "change since last flight" compares
--    two flights, and reviewer confirmations / corrections are rows too.
-- 3. share_work_orders: a flagged plot with a task, note, photo, assignee and
--    status. Created from the bay card on the map or from the phone in the field.
-- RLS enabled with no policies: all access through service-role API routes
-- gated by the share token, as for share_plots.

ALTER TABLE share_plots
  ADD COLUMN IF NOT EXISTS bay_ref TEXT,                 -- e.g. '14-23'; unique per share when set
  ADD COLUMN IF NOT EXISTS bed_ref TEXT,                 -- e.g. '14'
  ADD COLUMN IF NOT EXISTS count_method TEXT,            -- detector | lattice | hand | edited | estimate
  ADD COLUMN IF NOT EXISTS count_confidence TEXT,        -- verified | good | medium | estimate
  ADD COLUMN IF NOT EXISTS plant_count INTEGER;          -- latest published count (mirror of share_plot_counts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_plots_bay_ref ON share_plots(share_id, bay_ref) WHERE bay_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS share_plot_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES property_shares(id) ON DELETE CASCADE,
  plot_id UUID NOT NULL REFERENCES share_plots(id) ON DELETE CASCADE,
  flight_key TEXT NOT NULL,                              -- property_shares.flights[].key
  version TEXT NOT NULL,                                 -- e.g. 'v54'
  plant_count INTEGER NOT NULL,
  method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  expected_error_pct NUMERIC,                            -- e.g. 3 for ±3%
  source TEXT NOT NULL DEFAULT 'plnt',                   -- plnt | reviewer_confirmed | reviewer_corrected
  note TEXT,
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_share_plot_counts_plot ON share_plot_counts(plot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_plot_counts_share_flight ON share_plot_counts(share_id, flight_key);
ALTER TABLE share_plot_counts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS share_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES property_shares(id) ON DELETE CASCADE,
  plot_id UUID REFERENCES share_plots(id) ON DELETE SET NULL,
  bay_ref TEXT,                                          -- kept even if the plot is deleted
  task TEXT NOT NULL,                                    -- water | prune | space | relocate | upsize | pull | spray_ipm | other
  note TEXT,
  photo_path TEXT,                                       -- storage path in the property-shares bucket
  location JSONB,                                        -- {lat,lng} where it was created (phone) or the plot centroid
  plant_count_at_creation INTEGER,
  created_by_email TEXT,
  assigned_to TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',                   -- open | done | cancelled
  done_at TIMESTAMPTZ,
  done_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_share_work_orders_share ON share_work_orders(share_id, status, created_at DESC);
ALTER TABLE share_work_orders ENABLE ROW LEVEL SECURITY;
