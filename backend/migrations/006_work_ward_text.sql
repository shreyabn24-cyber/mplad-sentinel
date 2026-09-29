-- The public feed's ward field can contain a full locality description.
-- Keep it as text rather than truncating or rejecting those real rows.
ALTER TABLE works ALTER COLUMN ward TYPE TEXT;
