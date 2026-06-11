-- Per-client portal links
-- ============================================================================
-- A client_portal is one stable, unguessable link (/portal/<token>) given to a
-- client. After they enter an email on the portal's allowlist, they see every
-- property_share their email is authorized for and can switch between them —
-- decoupled from any single share, so it never breaks when a map is replaced.
--
-- Front-door auth = the portal's allowed_emails. Which locations they then see
-- is still governed per-map by each property_share's own allowed_emails, so a
-- portal can't widen access beyond what each share already grants.
--
-- All reads/writes go through service-role API routes, so RLS is enabled with
-- no policies (denies direct anon/authenticated access), matching property_shares.

CREATE TABLE IF NOT EXISTS client_portals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  -- For your reference (e.g. the client/company name); not shown to viewers.
  label TEXT,
  -- Lower-cased emails allowed to open this portal.
  allowed_emails TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_portals_token ON client_portals(token);

ALTER TABLE client_portals ENABLE ROW LEVEL SECURITY;
-- No policies: access is mediated entirely by service-role API routes.
