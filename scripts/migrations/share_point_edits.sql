-- share_point_edits — viewer corrections to the plant count on a gated share.
--
-- The detection output (points.json + the flight's baked plant_count) stays
-- immutable. Each row here is one manual correction a client made on the link:
--   kind='add'    -> a plant the model missed, placed at (lat,lng)
--   kind='remove' -> a detected plant that was double-counted / wrong; (lat,lng)
--                    is the detected dot to hide (matched at 6-decimal precision)
--
-- The viewer merges these over the base points, and the shown count becomes
--   baked_count + (#add) - (#remove).
--
-- This table is written ONLY through the service-role API route
-- (/api/share/[token]/points), gated by the share access token. We enable RLS
-- and add NO policies: that denies the public anon/authenticated keys any direct
-- access, while the service-role key the API route uses bypasses RLS entirely.
-- Result: the feature works, but nobody can reach this table via the browser
-- anon key (which would bypass the share's email gate).
--
-- Run this once in the Supabase dashboard SQL editor.

create table if not exists public.share_point_edits (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null references public.property_shares(id) on delete cascade,
  flight_key      text not null default '',
  kind            text not null check (kind in ('add', 'remove')),
  lat             double precision not null,
  lng             double precision not null,
  created_by_email text,
  created_at      timestamptz not null default now()
);

-- All lookups are "edits for this share + flight".
create index if not exists share_point_edits_share_flight_idx
  on public.share_point_edits (share_id, flight_key);

-- Lock the table to server-side (service-role) access only. No policies = the
-- anon/authenticated keys get nothing; the service key ignores RLS.
alter table public.share_point_edits enable row level security;
