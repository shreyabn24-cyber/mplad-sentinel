-- 003 — Citizen evidence uploads and a real demand register
--
-- Replaces a workflow that existed only in the browser. `frontend/lib/auth.tsx`
-- stored citizen demands in localStorage and simulated the entire government
-- chain: the MP portal "endorsed" a request and the district portal issued a
-- sanction displaying a fabricated `SO-KAN-<digits>` order number and a random
-- `PFMS<date><state><digits>` UTR. No office was contacted and no order
-- existed, yet the UI stated that administrative sanction had been accorded.
--
-- These tables record only what is true: a request was received, who sent it,
-- what evidence was attached, and whether it has been routed for review.

CREATE TABLE IF NOT EXISTS citizen_demands (
    demand_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- This portal's own receipt id. Deliberately NOT an official sanction or
    -- office order number, and rendered with that caveat wherever shown.
    acknowledgement_ref VARCHAR(32) NOT NULL UNIQUE,

    submitted_by        VARCHAR(100) NOT NULL,
    submitted_by_name   VARCHAR(200),
    contact_phone       VARCHAR(20),
    contact_email       VARCHAR(200),

    state_code          VARCHAR(2),
    district_name       VARCHAR(100),
    constituency_name   VARCHAR(150),
    village             VARCHAR(150),

    work_category       VARCHAR(60),
    work_title          TEXT NOT NULL,
    description         TEXT,
    estimated_amount    NUMERIC(15, 2),

    routed_to_role      VARCHAR(30),
    routed_at           TIMESTAMP,

    status              VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
    decision_note       TEXT,
    decided_by          VARCHAR(100),
    decided_at          TIMESTAMP,

    created_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_citizen_demands_status        ON citizen_demands (status);
CREATE INDEX IF NOT EXISTS ix_citizen_demands_constituency  ON citizen_demands (constituency_name);
CREATE INDEX IF NOT EXISTS ix_citizen_demands_submitted_by  ON citizen_demands (submitted_by);
CREATE INDEX IF NOT EXISTS ix_citizen_demands_created_at    ON citizen_demands (created_at DESC);

-- `photo_url` on citizen_reports was never populated: the API had no upload
-- route, and the frontend captured no file. Keep the column for compatibility
-- but point it at the same evidence model used by demands.
ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS reporter_user_id UUID;

CREATE TABLE IF NOT EXISTS evidence_attachments (
    attachment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id          UUID REFERENCES citizen_reports (report_id) ON DELETE CASCADE,
    demand_id          UUID REFERENCES citizen_demands  (demand_id) ON DELETE CASCADE,
    original_filename  VARCHAR(255) NOT NULL,
    -- Server-generated relative path. The client filename is never used to
    -- build a path, so a crafted name cannot escape the upload directory.
    storage_key        TEXT NOT NULL,
    content_type       VARCHAR(100),
    size_bytes         INTEGER,
    sha256             VARCHAR(64),
    uploaded_by        VARCHAR(100),
    uploaded_at        TIMESTAMP NOT NULL DEFAULT now(),
    -- An attachment must belong to exactly one parent.
    --
    -- Named to match the CheckConstraint in backend/models/models.py
    -- (`ck_evidence_exactly_one_parent`). It was previously
    -- `evidence_single_parent`: same predicate, different name, which means a
    -- schema built by this migration and one built by `Base.metadata.create_all`
    -- end up with two differently-named copies of the same check, and a
    -- drop-and-recreate through Alembic would emit a spurious diff every time.
    CONSTRAINT ck_evidence_exactly_one_parent CHECK (
        (report_id IS NOT NULL AND demand_id IS NULL) OR
        (report_id IS NULL     AND demand_id IS NOT NULL)
    )
);

-- Rename the constraint in databases that already ran the old name, so the
-- live schema converges on the ORM. Dropping the duplicate is safe: the
-- replacement below carries an identical predicate, and an attachment that
-- violated it could not have been inserted in the first place.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'evidence_single_parent'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_evidence_exactly_one_parent'
    ) THEN
        ALTER TABLE evidence_attachments
            RENAME CONSTRAINT evidence_single_parent
            TO ck_evidence_exactly_one_parent;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_evidence_report ON evidence_attachments (report_id);
CREATE INDEX IF NOT EXISTS ix_evidence_demand ON evidence_attachments (demand_id);

-- Notification delivery is exposed over SSE. Broadcasts used to be open to any
-- anonymous caller, which let a third party push arbitrary text to every
-- connected operator. The audit log now records who broadcast what.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_not_null') THEN
        ALTER TABLE audit_log ALTER COLUMN actor SET NOT NULL;
    END IF;
END
$$;
