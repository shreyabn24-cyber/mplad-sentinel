-- The public works API exposes its denormalized district label directly.
-- Older installations only had district_code; keep the field nullable because
-- the public MPLADS feed does not provide a consistent district for every row.
ALTER TABLE works ADD COLUMN IF NOT EXISTS district_name VARCHAR(100);
