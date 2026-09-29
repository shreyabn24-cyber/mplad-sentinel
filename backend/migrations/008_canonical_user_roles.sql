-- 008 — Replace bootstrap role labels with the API's canonical role set.
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
