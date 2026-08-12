-- share_plots.manual_count — an operator-entered plant count for one drawn plot.
--
-- The inventory drawer normally derives a plot's count by point-in-polygon:
-- how many detected plants (points.json, plus the viewer's add/remove edits)
-- fall inside the boundary. That is right almost everywhere, but some sections
-- can't be counted from the imagery — a strip the flight didn't cover, a block
-- under shade cloth, plants too small for the model at this GSD, or stock that
-- was staged after the flight. For those, someone who walked the block knows
-- the real number.
--
-- When manual_count is NOT NULL it OVERRIDES the derived count for that plot
-- everywhere the inventory totals it (drawer rows, species/size rollups, CSV).
-- NULL means "keep deriving it from the imagery" — which stays the default, so
-- every existing plot is unaffected by this migration.
--
-- Deliberately a per-plot override rather than a separate table: a count belongs
-- to the polygon it was counted in, and it should die with the polygon. The
-- on-delete-cascade from share_plots gives that for free.
--
-- Written ONLY through the service-role API route (/api/share/[token]/plots),
-- gated by the share access token — same path, and same RLS posture, as every
-- other column on this table.
--
-- Run this once in the Supabase dashboard SQL editor.

alter table public.share_plots
  add column if not exists manual_count integer;

-- A count is a non-negative whole number of plants. Rejects negatives outright
-- rather than letting one silently drag a species rollup down.
do $$
begin
  alter table public.share_plots
    add constraint share_plots_manual_count_nonneg check (manual_count is null or manual_count >= 0);
exception
  when duplicate_object then null;  -- already applied
end $$;

comment on column public.share_plots.manual_count is
  'Operator-entered plant count for this plot. When set, overrides the point-in-polygon count derived from the flight''s detections. NULL = derive from imagery.';
