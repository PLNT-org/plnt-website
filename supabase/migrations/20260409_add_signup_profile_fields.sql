-- Add signup profile fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS acres NUMERIC;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS propagation_methods JSONB DEFAULT '[]';
