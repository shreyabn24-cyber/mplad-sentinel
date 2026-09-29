-- 002 — Carry the open MPLADS feed's own fields
--
-- The Work model was built against a synthetic schema (work_type,
-- sanction_date, district_code) and had no way to represent the values the
-- real feed actually publishes. The result was a lossy import: an MP's name,
-- house, constituency, village and the scheme's own "recommended vs
-- sanctioned" distinction were all discarded, and the map had no coordinates
-- to plot because there was no column to receive them.
--
-- Every column added here is nullable and is populated only from
-- data/output/works_real.csv. Nothing is defaulted: an absent upstream value
-- must stay absent.

-- The work key moves from VARCHAR(20) to VARCHAR(64) to hold a real MPLADS
-- reference such as 'WS/MP521/2023-2024/3061'.
--
-- These are wrapped in a guard on information_schema rather than written as
-- bare ALTERs, because a bare ALTER COLUMN ... TYPE is not idempotent: a second
-- manual run of this file would fail even though the column is already the
-- right width. PostgreSQL has no "IF EXISTS" form for an ALTER COLUMN, so the
-- current type has to be read from the catalog.
DO $$
DECLARE
    t   integer;
    tbl text;
    col text;
    target_len int := 64;
BEGIN
    FOR tbl, col IN
        SELECT table_name, column_name
        FROM (VALUES
            ('works', 'work_id'),
            ('risk_scores', 'work_id'),
            ('satellite_checks', 'work_id'),
            ('citizen_reports', 'work_id')
        ) AS work_key_columns(table_name, column_name)
    LOOP
        SELECT character_maximum_length INTO t
        FROM information_schema.columns
        WHERE table_name = tbl
          AND column_name = col
          AND table_schema = 'public';

        IF t IS NOT NULL AND t <> target_len THEN
            EXECUTE format(
                'ALTER TABLE public.%I ALTER COLUMN %I TYPE VARCHAR(%s)',
                tbl, col, target_len
            );
            RAISE NOTICE 'widened %.% from % to %', tbl, col, t, target_len;
        END IF;
    END LOOP;

    -- cross_scheme_matches keys the MPLADS side under a different column name.
    SELECT character_maximum_length INTO t
    FROM information_schema.columns
    WHERE table_name = 'cross_scheme_matches'
      AND column_name = 'work_id_mplads'
      AND table_schema = 'public';

    IF t IS NOT NULL AND t <> target_len THEN
        EXECUTE format(
            'ALTER TABLE public.cross_scheme_matches
             ALTER COLUMN work_id_mplads TYPE VARCHAR(%s)',
            target_len
        );
        RAISE NOTICE 'widened cross_scheme_matches.work_id_mplads from % to %',
            t, target_len;
    END IF;
END
$$;

-- How a row's key was obtained: 'OFFICIAL' when the feed carried a real
-- reference, 'DERIVED' when it is a SHA-1 surrogate because MPLADS publishes
-- no identifier for that work.
ALTER TABLE works ADD COLUMN IF NOT EXISTS work_id_source      VARCHAR(10);
ALTER TABLE works ADD COLUMN IF NOT EXISTS official_work_ref  VARCHAR(100);
ALTER TABLE works ADD COLUMN IF NOT EXISTS upstream_row       INTEGER;
ALTER TABLE works ADD COLUMN IF NOT EXISTS mp_name            VARCHAR(200);
ALTER TABLE works ADD COLUMN IF NOT EXISTS house              VARCHAR(20);
ALTER TABLE works ADD COLUMN IF NOT EXISTS constituency_name  VARCHAR(200);
ALTER TABLE works ADD COLUMN IF NOT EXISTS constituency_code  VARCHAR(10);
ALTER TABLE works ADD COLUMN IF NOT EXISTS state_name         VARCHAR(100);
ALTER TABLE works ADD COLUMN IF NOT EXISTS work_category      VARCHAR(60);
ALTER TABLE works ADD COLUMN IF NOT EXISTS city               VARCHAR(100);
ALTER TABLE works ADD COLUMN IF NOT EXISTS ward               VARCHAR(50);
ALTER TABLE works ADD COLUMN IF NOT EXISTS block              VARCHAR(100);
ALTER TABLE works ADD COLUMN IF NOT EXISTS village            VARCHAR(150);
ALTER TABLE works ADD COLUMN IF NOT EXISTS recommended_date   DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS ida_approval       VARCHAR(60);
ALTER TABLE works ADD COLUMN IF NOT EXISTS data_as_on         DATE;

-- Provenance of any stored coordinate. The open feed publishes no surveyed
-- work GPS, so the only legitimate value here is a place centroid
-- ('CENTROID'). The column exists so the UI can say which it is rather than
-- presenting a village centroid as the work's location.
ALTER TABLE works ADD COLUMN IF NOT EXISTS coordinate_precision VARCHAR(20);

-- The district columns had no source in the feed. Previously they were
-- required-looking in the API response model while always being NULL in
-- practice; they are now explicitly nullable (they already were) and the
-- schema advertises that by grouping them with the feed columns.

CREATE INDEX IF NOT EXISTS ix_works_official_work_ref  ON works (official_work_ref);
CREATE INDEX IF NOT EXISTS ix_works_constituency_code  ON works (constituency_code);
CREATE INDEX IF NOT EXISTS ix_works_mp_id              ON works (mp_id);
CREATE INDEX IF NOT EXISTS ix_works_coordinates        ON works (reported_lat, reported_lon)
    WHERE reported_lat IS NOT NULL;

-- Reconciliation between an official reference and a derived key: the audit
-- route cross-checks these counts.
CREATE INDEX IF NOT EXISTS ix_works_id_source ON works (work_id_source);

-- Risk scores carry a review verdict; the reviewer used to be recorded as the
-- literal string 'SYSTEM', so the audit trail could not identify the actor.
ALTER TABLE risk_scores ADD COLUMN IF NOT EXISTS reviewed_by_role VARCHAR(30);

-- Contractor records are not populated (no GSTIN source). Their endpoint must
-- not present an empty table as a healthy graph, so mark the intent here.
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS data_source VARCHAR(60);
UPDATE contractors SET data_source = 'NONE' WHERE data_source IS NULL;
