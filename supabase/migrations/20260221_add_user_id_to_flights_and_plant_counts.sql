-- Add user_id to flights table for direct user-level filtering
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Add user_id to plant_counts table for direct user-level filtering
ALTER TABLE public.plant_counts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Backfill flights.user_id from flight_plans.user_id
UPDATE public.flights f
SET user_id = fp.user_id
FROM public.flight_plans fp
WHERE f.flight_plan_id = fp.id
  AND f.user_id IS NULL;

-- Backfill plant_counts.user_id through flights → flight_plans
UPDATE public.plant_counts pc
SET user_id = fp.user_id
FROM public.flights f
JOIN public.flight_plans fp ON f.flight_plan_id = fp.id
WHERE pc.flight_id = f.id
  AND pc.user_id IS NULL;
