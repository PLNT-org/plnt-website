-- Enable RLS on flights table
ALTER TABLE flights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own flights" ON flights
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own flights" ON flights
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own flights" ON flights
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own flights" ON flights
  FOR DELETE USING (user_id = auth.uid());

-- Enable RLS on plant_counts table
ALTER TABLE plant_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plant_counts" ON plant_counts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own plant_counts" ON plant_counts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own plant_counts" ON plant_counts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own plant_counts" ON plant_counts
  FOR DELETE USING (user_id = auth.uid());

-- Add indexes (missing from the original migration)
CREATE INDEX IF NOT EXISTS idx_flights_user_id ON flights(user_id);
CREATE INDEX IF NOT EXISTS idx_plant_counts_user_id ON plant_counts(user_id);
