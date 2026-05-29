-- Email-gated public sharing of property surveys (RGB / NDVI / CHM)
-- =================================================================
-- A property_share bundles one or more raster layers (stored as COGs in the
-- private `property-shares` bucket) behind a public token URL. Anyone with the
-- link must enter an email that is on `allowed_emails` to view the layers.
--
-- All reads/writes happen through service-role API routes, so RLS is enabled
-- with no policies (denies direct anon/authenticated access by default).

CREATE TABLE IF NOT EXISTS property_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Public, unguessable token used in the share URL (/share/<token>)
  token TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT,
  -- Lower-cased emails authorized to view this share
  allowed_emails TEXT[] NOT NULL DEFAULT '{}',
  -- [{ type: 'rgb'|'ndvi'|'chm', storage_path, bounds:{north,south,east,west},
  --    value_min?, value_max? }]
  layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Union of all layer bounds, used for the initial map fit
  bounds JSONB,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_shares_token ON property_shares(token);
CREATE INDEX IF NOT EXISTS idx_property_shares_created_by ON property_shares(created_by);

ALTER TABLE property_shares ENABLE ROW LEVEL SECURITY;
-- No policies: access is mediated entirely by service-role API routes.

-- Private bucket for share COGs. Files are served to viewers only via
-- short-lived signed URLs minted after the email allowlist check passes.
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-shares', 'property-shares', false)
ON CONFLICT (id) DO NOTHING;
