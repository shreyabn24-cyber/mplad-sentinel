-- 007 — Bring legacy bootstrap user tables in line with the auth model.
-- Some existing installs ran database/init.sql before migration 001 and
-- recorded 001 as applied while the older users table lacked these columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS jurisdiction_state VARCHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS district_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS constituency_name VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mp_id VARCHAR(20);

-- The bootstrap schema used role names incompatible with the API. Map the
-- known legacy roles, then enforce the same canonical values as backend.auth.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = CASE role
    WHEN 'INTERNAL' THEN 'ADMIN'
    WHEN 'DISTRICT_AUDITOR' THEN 'DISTRICT_AUTHORITY'
    WHEN 'CAG_OFFICER' THEN 'AUDITOR'
    ELSE role
END WHERE role IN ('INTERNAL', 'DISTRICT_AUDITOR', 'CAG_OFFICER');
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_known') THEN
        ALTER TABLE users ADD CONSTRAINT users_role_known
            CHECK (role IN ('CITIZEN', 'MP', 'AUDITOR', 'DISTRICT_AUTHORITY', 'ADMIN'));
    END IF;
END
$$;
