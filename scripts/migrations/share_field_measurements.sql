-- share_field_measurements — the height (or other value) actually measured in
-- the field for one published field target.
--
-- The model's estimate lives in the flight's field-targets.json and stays
-- immutable. Each row here is one ground-truth reading taken standing at the
-- plant, keyed to that target's id (the plant id, e.g. MR-B03-0905):
--   height_m  -> the measured height in METRES (the viewer converts from feet)
--   notes     -> free text: "leader broken", "wrong plant", "couldn't reach"
--
-- One row per (share, flight, target) — re-measuring overwrites, so the table
-- always holds the current reading rather than a pile of guesses. Clearing a
-- measurement deletes the row.
--
-- Written ONLY through the service-role API route
-- (/api/share/[token]/measurements), gated by the share access token. RLS is on
-- with NO policies: the public anon/authenticated keys get nothing, while the
-- service-role key the API route uses bypasses RLS entirely. Same model as
-- share_point_edits.sql.
--
-- Run this once in the Supabase dashboard SQL editor.

create table if not exists public.share_field_measurements (
  id                uuid primary key default gen_random_uuid(),
  share_id          uuid not null references public.property_shares(id) on delete cascade,
  flight_key        text not null default '',
  target_id         text not null,
  height_m          double precision check (height_m is null or (height_m >= 0 and height_m < 200)),
  notes             text,
  measured_by_email text,
  measured_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  -- A reading with neither a height nor a note is just noise; require one.
  constraint share_field_measurements_has_content check (height_m is not null or notes is not null)
);

-- One current reading per target, so the API can upsert on it.
create unique index if not exists share_field_measurements_target_uniq
  on public.share_field_measurements (share_id, flight_key, target_id);

-- Lock the table to server-side (service-role) access only.
alter table public.share_field_measurements enable row level security;
