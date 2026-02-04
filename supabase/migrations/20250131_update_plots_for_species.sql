-- Migration: Add species linkage and status to plots table for Phase 2
-- This enables linking plots to species and tracking plot lifecycle

-- Add species_id foreign key to plots table
ALTER TABLE plots ADD COLUMN IF NOT EXISTS species_id UUID REFERENCES species(id) ON DELETE SET NULL;

-- Add index for species lookup
CREATE INDEX IF NOT EXISTS idx_plots_species ON plots(species_id);

-- Add status field for plot lifecycle
ALTER TABLE plots ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Add check constraint for status values (separate statement for compatibility)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'plots_status_check'
    ) THEN
        ALTER TABLE plots ADD CONSTRAINT plots_status_check
            CHECK (status IN ('active', 'archived', 'planning'));
    END IF;
END $$;

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_plots_status ON plots(status);
