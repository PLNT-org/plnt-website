-- When a plot was planted, shown beside the readiness date in the share inventory.
ALTER TABLE share_plots ADD COLUMN IF NOT EXISTS planted_date DATE;
