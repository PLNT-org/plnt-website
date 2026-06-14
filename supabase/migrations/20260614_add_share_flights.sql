-- Orthophotos over time: multiple dated flights per parcel
-- ============================================================================
-- A property_share is a parcel. It now keeps a list of dated "flights", each a
-- full orthophoto set (tiles + plant points), so viewers can switch between
-- dates. Boundaries (share_plots) stay keyed to the parcel and are shared across
-- all flights, so a bed persists while you scrub through dates.
--
-- Each flight: {
--   key: string,        -- storage-folder segment ('legacy' = pre-flights layout)
--   date: 'YYYY-MM-DD',
--   bounds: {north,south,east,west},
--   layers: [ same shape as property_shares.layers ]
-- }
-- The top-level layers/bounds continue to mirror the latest flight.

ALTER TABLE property_shares
  ADD COLUMN IF NOT EXISTS flights JSONB NOT NULL DEFAULT '[]'::jsonb;
