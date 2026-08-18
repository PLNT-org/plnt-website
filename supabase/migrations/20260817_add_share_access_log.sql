-- Audit trail for gated client links
-- ============================================================================
-- Every attempt to redeem a share link (/share/<token>) or a client portal
-- (/portal/<token>) appends one row here — successes and failures alike.
--
-- Failures matter as much as successes: "wrong email, three times yesterday"
-- is the signal that a grower has the link but can't get in, which is
-- otherwise completely invisible to us.
--
-- Written and read only through service-role API routes, so RLS is enabled
-- with no policies, matching property_shares and client_portals.

CREATE TABLE IF NOT EXISTS share_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which kind of link was opened.
  link_type TEXT NOT NULL CHECK (link_type IN ('share', 'portal')),

  -- The token as presented, kept even when it matches nothing so that probing
  -- for valid tokens is visible.
  token TEXT NOT NULL,

  -- Resolved row, when the token matched. Null on not_found. Deliberately not
  -- FK-constrained: deleting a share must not erase its access history.
  share_id UUID,
  portal_id UUID,

  -- Lower-cased email as entered. Null when the request had no usable email.
  email TEXT,

  --   granted       email cleared the allowlist, content returned
  --   denied_email  valid link, email not on the allowlist
  --   expired       valid link, past expires_at
  --   not_found     no share/portal with that token
  --   invalid_email malformed or missing email
  outcome TEXT NOT NULL CHECK (
    outcome IN ('granted', 'denied_email', 'expired', 'not_found', 'invalid_email')
  ),

  -- Best-effort client attribution from proxy headers.
  ip TEXT,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newest-first listing is the default admin view.
CREATE INDEX IF NOT EXISTS idx_share_access_log_created_at
  ON share_access_log (created_at DESC);

-- "Has this particular link been opened?"
CREATE INDEX IF NOT EXISTS idx_share_access_log_token
  ON share_access_log (token, created_at DESC);

-- "What has this grower looked at?"
CREATE INDEX IF NOT EXISTS idx_share_access_log_email
  ON share_access_log (email, created_at DESC);

ALTER TABLE share_access_log ENABLE ROW LEVEL SECURITY;
-- No policies: access is mediated entirely by service-role API routes.
