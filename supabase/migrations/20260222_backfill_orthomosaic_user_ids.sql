-- Backfill orthomosaics.user_id for records that have NULL user_id
-- Traces through: orthomosaic -> flight -> flight_plan -> user_id

UPDATE orthomosaics o
SET user_id = fp.user_id
FROM flights f
JOIN flight_plans fp ON f.flight_plan_id = fp.id
WHERE o.flight_id = f.id
  AND o.user_id IS NULL
  AND fp.user_id IS NOT NULL;
