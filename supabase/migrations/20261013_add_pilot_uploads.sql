-- Pilot upload links
-- ============================================================================
-- A pilot_upload_link is one unguessable link (/upload/<token>) handed to a
-- contract drone pilot so they can deliver a flight's raw imagery straight into
-- our storage — hundreds of DJI JPG/TIF files — without an account.
--
-- Files go browser -> Supabase Storage directly (signed upload URLs minted by a
-- service-role route per file), so nothing streams through Vercel. One row per
-- received file in pilot_upload_files, with the GPS/altitude read from the DJI
-- XMP in the browser so we can sanity-check coverage before processing.
--
-- All reads/writes go through service-role API routes: RLS on, no policies,
-- matching property_shares and client_portals.

CREATE TABLE IF NOT EXISTS pilot_upload_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  -- Who we gave the link to, and what it's for.
  pilot_name TEXT,
  pilot_email TEXT,
  client_name TEXT NOT NULL,
  site_name TEXT,
  instructions TEXT,                 -- shown on the portal (flight specs, what to upload)
  -- open: accepting files; submitted: pilot pressed Done; closed: we stopped accepting.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'closed')),
  max_files INTEGER NOT NULL DEFAULT 5000,
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  submitted_notes TEXT,              -- what the pilot wrote when submitting
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  last_upload_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pilot_upload_links_token ON pilot_upload_links(token);
ALTER TABLE pilot_upload_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pilot_upload_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES pilot_upload_links(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,        -- <link_id>/<file_name> in the pilot-uploads bucket
  size_bytes BIGINT NOT NULL,
  content_type TEXT,
  -- From the DJI XMP packet, parsed in the browser before upload (null if absent).
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  rel_alt_m DOUBLE PRECISION,
  gimbal_pitch_deg DOUBLE PRECISION,
  captured_at TIMESTAMPTZ,
  camera_model TEXT,
  gps_status TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (link_id, file_name)
);
CREATE INDEX IF NOT EXISTS idx_pilot_upload_files_link ON pilot_upload_files(link_id);
ALTER TABLE pilot_upload_files ENABLE ROW LEVEL SECURITY;

-- Private bucket for the raw imagery. 200 MB per object covers DJI JPG (~10 MB),
-- multispectral TIF (~10 MB) and the occasional panorama/DNG.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pilot-uploads', 'pilot-uploads', false, 209715200,
  ARRAY['image/jpeg', 'image/tiff', 'image/x-adobe-dng', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;
