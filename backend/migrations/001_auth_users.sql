-- 001 — Real authentication
--
-- Adds the operator accounts the API now requires, and the jurisdiction
-- columns that scope what an MP or District Authority account may act on.
--
-- Idempotent: safe to run more than once. Alembic is declared in
-- requirements.txt but is not installed in every environment, so migrations
-- are plain SQL applied by backend/migrations/run_migrations.py.

-- gen_random_uuid() is built into PostgreSQL 13 and later. On 12 and earlier it
-- comes from pgcrypto, so request the extension rather than failing on a
-- function that does not exist. IF NOT EXISTS keeps this a no-op where the
-- function is already built in or the extension is already installed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    user_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username           VARCHAR(100) NOT NULL UNIQUE,
    email              VARCHAR(200) NOT NULL UNIQUE,
    hashed_password    VARCHAR(255) NOT NULL,
    full_name          VARCHAR(200),
    role               VARCHAR(30)  NOT NULL,
    jurisdiction_state VARCHAR(2),
    district_name      VARCHAR(100),
    constituency_name  VARCHAR(150),
    mp_id              VARCHAR(20),
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login         TIMESTAMP,
    created_at         TIMESTAMP    NOT NULL DEFAULT now()
);

-- A PUBLIC value is rejected at runtime (backend/auth.py refuses to issue or
-- accept a token for it) so this CHECK is a second line of defence rather than
-- the only one.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_known') THEN
        ALTER TABLE users ADD CONSTRAINT users_role_known
            CHECK (role IN ('CITIZEN', 'MP', 'AUDITOR', 'DISTRICT_AUTHORITY', 'ADMIN'));
    END IF;
END
$$;

-- Username lookups are case-insensitive (the login query lowercases both
-- sides), so uniqueness must be too or "Auditor1" and "auditor1" could both
-- be created and only one would ever be reachable.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
    ON users (lower(username));

-- One row per in-flight request, for the anomaly review queue.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_is_active_not_null') THEN
        ALTER TABLE users ALTER COLUMN is_active SET NOT NULL;
    END IF;
END
$$;
