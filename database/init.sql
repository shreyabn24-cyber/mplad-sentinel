-- ============================================================
-- MPLADS Sentinel — PostgreSQL Schema
-- Run: psql -U mplads -d mplads_sentinel -f init.sql
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fuzzy text matching

-- ============================================================
-- REFERENCE TABLES
-- ============================================================

CREATE TABLE states (
    state_code      VARCHAR(2) PRIMARY KEY,
    state_name      VARCHAR(100) NOT NULL,
    region          VARCHAR(50)
);

CREATE TABLE districts (
    district_code   VARCHAR(10) PRIMARY KEY,
    district_name   VARCHAR(100) NOT NULL,
    state_code      VARCHAR(2) REFERENCES states(state_code),
    latitude        FLOAT,
    longitude       FLOAT,
    population      INTEGER,
    area_sq_km      FLOAT,
    secc_deprivation_score FLOAT,   -- 0.0 to 1.0, higher = more deprived
    geometry        GEOMETRY(MULTIPOLYGON, 4326)
);

CREATE TABLE constituencies (
    constituency_code VARCHAR(10) PRIMARY KEY,
    constituency_name VARCHAR(100) NOT NULL,
    state_code      VARCHAR(2) REFERENCES states(state_code),
    constituency_type VARCHAR(20) CHECK (constituency_type IN ('LOKSABHA', 'RAJYASABHA')),
    geometry        GEOMETRY(MULTIPOLYGON, 4326)
);

-- ============================================================
-- MP TABLE
-- ============================================================

CREATE TABLE mps (
    mp_id               VARCHAR(20) PRIMARY KEY,  -- Format: MP-MH-001
    full_name           VARCHAR(200) NOT NULL,
    party               VARCHAR(100),
    constituency_code   VARCHAR(10) REFERENCES constituencies(constituency_code),
    state_code          VARCHAR(2) REFERENCES states(state_code),
    term_start          DATE,
    term_end            DATE,
    is_active           BOOLEAN DEFAULT TRUE,
    annual_allocation   NUMERIC(15,2) DEFAULT 50000000,  -- ₹5Cr
    email               VARCHAR(200),
    phone               VARCHAR(20),
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- CONTRACTORS TABLE
-- ============================================================

CREATE TABLE contractors (
    gstin               VARCHAR(20) PRIMARY KEY,
    name                VARCHAR(300) NOT NULL,
    address             TEXT,
    city                VARCHAR(100),
    state_code          VARCHAR(2) REFERENCES states(state_code),
    registration_date   DATE,
    gstin_status        VARCHAR(20) CHECK (gstin_status IN ('ACTIVE', 'CANCELLED', 'SUSPENDED', 'INACTIVE')),
    director_names      TEXT[],
    phone_numbers       TEXT[],
    total_contracts     INTEGER DEFAULT 0,
    total_contract_value NUMERIC(20,2) DEFAULT 0,
    risk_score          FLOAT DEFAULT 0.0,
    last_gstin_check    TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_contractors_status ON contractors(gstin_status);
CREATE INDEX idx_contractors_risk ON contractors(risk_score DESC);

-- ============================================================
-- WORKS TABLE (Core)
-- ============================================================

CREATE TABLE works (
    work_id             VARCHAR(50) PRIMARY KEY,  -- Format: MPLADS-2023-MH-441
    mp_id               VARCHAR(20) REFERENCES mps(mp_id),
    district_code       VARCHAR(10) REFERENCES districts(district_code),
    state_code          VARCHAR(2) REFERENCES states(state_code),
    work_type           VARCHAR(50) NOT NULL,
    work_type_category  VARCHAR(50),  -- roads, buildings, water, education, health
    work_description    TEXT,
    sanction_amount     NUMERIC(15,2),
    release_amount      NUMERIC(15,2),
    expenditure_amount  NUMERIC(15,2),
    sanction_date       DATE,
    completion_date     DATE,
    reported_lat        FLOAT,
    reported_lon        FLOAT,
    location_point      GEOMETRY(POINT, 4326),
    contractor_gstin    VARCHAR(20) REFERENCES contractors(gstin),
    implementing_agency VARCHAR(200),
    scheme_year         INTEGER,
    status              VARCHAR(30) CHECK (status IN ('SANCTIONED', 'IN_PROGRESS', 'COMPLETED', 'LAPSED', 'CANCELLED')),
    work_quantity       FLOAT,       -- e.g. 2.5 (km of road)
    work_unit           VARCHAR(20), -- e.g. 'km', 'sqft', 'nos'
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_works_mp ON works(mp_id);
CREATE INDEX idx_works_district ON works(district_code);
CREATE INDEX idx_works_status ON works(status);
CREATE INDEX idx_works_sanction_date ON works(sanction_date);
CREATE INDEX idx_works_location ON works USING GIST(location_point);

-- ============================================================
-- RISK SCORES TABLE
-- ============================================================

CREATE TABLE risk_scores (
    score_id            SERIAL PRIMARY KEY,
    work_id             VARCHAR(50) REFERENCES works(work_id),
    isolation_score     FLOAT DEFAULT 0.0,      -- 0-1, higher = more anomalous
    satellite_score     FLOAT DEFAULT 0.0,
    weather_score       FLOAT DEFAULT 0.0,
    gstin_score         FLOAT DEFAULT 0.0,
    graph_score         FLOAT DEFAULT 0.0,
    cross_scheme_score  FLOAT DEFAULT 0.0,
    citizen_score       FLOAT DEFAULT 0.0,
    nlp_speech_score    FLOAT DEFAULT 0.0,
    composite_score     FLOAT DEFAULT 0.0,      -- 0-100
    confidence_tier     VARCHAR(2) CHECK (confidence_tier IN ('L1', 'L2', 'L3')),
    model_version       VARCHAR(20),
    evidence_chain      JSONB,  -- Structured evidence from each signal
    auditor_reviewed    BOOLEAN DEFAULT FALSE,
    auditor_id          VARCHAR(50),
    auditor_verdict     VARCHAR(20) CHECK (auditor_verdict IN ('CONFIRMED', 'CLEARED', 'PENDING')),
    auditor_notes       TEXT,
    reviewed_at         TIMESTAMP,
    scored_at           TIMESTAMP DEFAULT NOW(),
    UNIQUE(work_id)
);

CREATE INDEX idx_risk_composite ON risk_scores(composite_score DESC);
CREATE INDEX idx_risk_tier ON risk_scores(confidence_tier);
CREATE INDEX idx_risk_reviewed ON risk_scores(auditor_reviewed);

-- ============================================================
-- CROSS-SCHEME MATCHES
-- ============================================================

CREATE TABLE cross_scheme_matches (
    match_id            SERIAL PRIMARY KEY,
    work_id_mplads      VARCHAR(50) REFERENCES works(work_id),
    work_id_other       VARCHAR(100) NOT NULL,
    other_scheme        VARCHAR(50) NOT NULL,   -- MGNREGA, MLALAD, PMGSY, etc.
    other_scheme_amount NUMERIC(15,2),
    similarity_score    FLOAT NOT NULL,          -- 0.0 to 1.0
    match_basis         TEXT[],                  -- ['location', 'description', 'amount', 'timeline']
    match_distance_m    FLOAT,                   -- Physical distance in meters
    description_similarity FLOAT,               -- NLP similarity score
    flagged_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cross_scheme_work ON cross_scheme_matches(work_id_mplads);
CREATE INDEX idx_cross_scheme_score ON cross_scheme_matches(similarity_score DESC);

-- ============================================================
-- SATELLITE CHECKS
-- ============================================================

CREATE TABLE satellite_checks (
    check_id            SERIAL PRIMARY KEY,
    work_id             VARCHAR(50) REFERENCES works(work_id),
    check_date          TIMESTAMP DEFAULT NOW(),
    date_before         DATE,
    date_after          DATE,
    ndbi_change         FLOAT,   -- Normalized Difference Built-up Index change
    ndvi_change         FLOAT,   -- Normalized Difference Vegetation Index change
    change_score        FLOAT,   -- Composite change score
    satellite_flag      BOOLEAN DEFAULT FALSE,
    confidence          FLOAT,   -- Model confidence in the assessment
    cloud_coverage_pct  FLOAT,   -- % cloud coverage (affects reliability)
    imagery_before_url  TEXT,
    imagery_after_url   TEXT,
    thumbnail_before_url TEXT,
    thumbnail_after_url TEXT,
    sentinel_tile_id    VARCHAR(50),
    model_version       VARCHAR(20),
    notes               TEXT
);

CREATE INDEX idx_satellite_work ON satellite_checks(work_id);
CREATE INDEX idx_satellite_flag ON satellite_checks(satellite_flag);

-- ============================================================
-- WEATHER FEASIBILITY
-- ============================================================

CREATE TABLE weather_checks (
    check_id            SERIAL PRIMARY KEY,
    work_id             VARCHAR(50) REFERENCES works(work_id),
    district_code       VARCHAR(10) REFERENCES districts(district_code),
    start_date          DATE,
    end_date            DATE,
    total_days          INTEGER,
    heavy_rain_days     INTEGER,
    avg_rainfall_mm     FLOAT,
    max_rainfall_mm     FLOAT,
    rain_threshold_mm   FLOAT,
    feasibility_flag    BOOLEAN DEFAULT FALSE,
    infeasibility_ratio FLOAT,  -- heavy_rain_days / total_days
    checked_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_weather_work ON weather_checks(work_id);

-- ============================================================
-- CITIZEN REPORTS
-- ============================================================

CREATE TABLE citizen_reports (
    report_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_id             VARCHAR(50) REFERENCES works(work_id),
    report_lat          FLOAT,
    report_lon          FLOAT,
    report_location_point GEOMETRY(POINT, 4326),
    construction_visible BOOLEAN,
    work_complete       BOOLEAN,
    matches_board_description BOOLEAN,
    quality_rating      INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
    comments            TEXT,
    photo_url           TEXT,
    distance_from_work_m FLOAT,  -- Computed: how far report was submitted from work
    submitted_at        TIMESTAMP DEFAULT NOW(),
    verified            BOOLEAN DEFAULT FALSE,
    verified_by         VARCHAR(50),
    verified_at         TIMESTAMP
);

CREATE INDEX idx_citizen_work ON citizen_reports(work_id);
CREATE INDEX idx_citizen_verified ON citizen_reports(verified);

-- ============================================================
-- FUND LAPSE FORECASTS
-- ============================================================

CREATE TABLE lapse_forecasts (
    forecast_id         SERIAL PRIMARY KEY,
    district_code       VARCHAR(10) REFERENCES districts(district_code),
    mp_id               VARCHAR(20) REFERENCES mps(mp_id),
    fiscal_year         INTEGER,
    forecast_date       DATE,
    allocated_amount    NUMERIC(15,2),
    spent_to_date       NUMERIC(15,2),
    prophet_forecast    NUMERIC(15,2),  -- Predicted spend by year end
    projected_lapse     NUMERIC(15,2),  -- Allocated - Projected spend
    lapse_probability   FLOAT,          -- 0.0 to 1.0
    lapse_tier          VARCHAR(10) CHECK (lapse_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    forecast_data       JSONB,          -- Full Prophet forecast JSON
    nudge_sent          BOOLEAN DEFAULT FALSE,
    nudge_sent_at       TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_lapse_district ON lapse_forecasts(district_code);
CREATE INDEX idx_lapse_mp ON lapse_forecasts(mp_id);
CREATE INDEX idx_lapse_tier ON lapse_forecasts(lapse_tier);

-- ============================================================
-- MP SPEECH ANALYSIS
-- ============================================================

CREATE TABLE mp_speech_analysis (
    analysis_id         SERIAL PRIMARY KEY,
    mp_id               VARCHAR(20) REFERENCES mps(mp_id),
    analysis_date       DATE,
    speech_topics       JSONB,          -- Top topics from NLP
    speech_districts    TEXT[],         -- Districts mentioned in speeches
    allocation_districts TEXT[],        -- Districts where funds were allocated
    alignment_score     FLOAT,          -- 0.0 to 1.0 (1.0 = perfect alignment)
    election_window_flag BOOLEAN,       -- Was allocation in 6-month pre-election window
    speeches_analyzed   INTEGER,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_speech_mp ON mp_speech_analysis(mp_id);

-- ============================================================
-- QUARTERLY EXPENDITURE (Time Series)
-- ============================================================

CREATE TABLE quarterly_expenditure (
    exp_id              SERIAL PRIMARY KEY,
    district_code       VARCHAR(10) REFERENCES districts(district_code),
    mp_id               VARCHAR(20) REFERENCES mps(mp_id),
    fiscal_year         INTEGER,
    quarter             INTEGER CHECK (quarter BETWEEN 1 AND 4),
    allocated_amount    NUMERIC(15,2),
    spent_amount        NUMERIC(15,2),
    works_sanctioned    INTEGER,
    works_completed     INTEGER,
    cumulative_spent    NUMERIC(15,2),
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(district_code, mp_id, fiscal_year, quarter)
);

CREATE INDEX idx_quarterly_mp ON quarterly_expenditure(mp_id, fiscal_year);

-- ============================================================
-- AUDIT LOG (IMMUTABLE)
-- ============================================================

CREATE TABLE audit_log (
    log_id              SERIAL PRIMARY KEY,
    action              VARCHAR(100) NOT NULL,
    actor               VARCHAR(100),  -- User ID or 'SYSTEM'
    entity_type         VARCHAR(50),   -- 'work', 'risk_score', 'contractor', etc.
    entity_id           VARCHAR(100),
    old_value           JSONB,
    new_value           JSONB,
    ip_address          INET,
    user_agent          TEXT,
    timestamp           TIMESTAMP DEFAULT NOW()
);

-- Audit log is append-only — no updates or deletes allowed
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ============================================================
-- USERS (Auditor Accounts)
-- ============================================================

CREATE TABLE users (
    user_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username            VARCHAR(100) UNIQUE NOT NULL,
    email               VARCHAR(200) UNIQUE NOT NULL,
    hashed_password     VARCHAR(200) NOT NULL,
    full_name           VARCHAR(200),
    role                VARCHAR(30) CHECK (role IN ('CITIZEN', 'MP', 'AUDITOR', 'DISTRICT_AUTHORITY', 'ADMIN')),
    jurisdiction_state  VARCHAR(2),   -- NULL = all states
    is_active           BOOLEAN DEFAULT TRUE,
    last_login          TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- SEED STATE DATA
-- ============================================================

INSERT INTO states (state_code, state_name, region) VALUES
('AN', 'Andaman and Nicobar Islands', 'East'),
('AP', 'Andhra Pradesh', 'South'),
('AR', 'Arunachal Pradesh', 'Northeast'),
('AS', 'Assam', 'Northeast'),
('BR', 'Bihar', 'East'),
('CH', 'Chandigarh', 'North'),
('CT', 'Chhattisgarh', 'Central'),
('DN', 'Dadra and Nagar Haveli', 'West'),
('DD', 'Daman and Diu', 'West'),
('DL', 'Delhi', 'North'),
('GA', 'Goa', 'West'),
('GJ', 'Gujarat', 'West'),
('HR', 'Haryana', 'North'),
('HP', 'Himachal Pradesh', 'North'),
('JK', 'Jammu and Kashmir', 'North'),
('JH', 'Jharkhand', 'East'),
('KA', 'Karnataka', 'South'),
('KL', 'Kerala', 'South'),
('LA', 'Ladakh', 'North'),
('LD', 'Lakshadweep', 'South'),
('MP', 'Madhya Pradesh', 'Central'),
('MH', 'Maharashtra', 'West'),
('MN', 'Manipur', 'Northeast'),
('ML', 'Meghalaya', 'Northeast'),
('MZ', 'Mizoram', 'Northeast'),
('NL', 'Nagaland', 'Northeast'),
('OR', 'Odisha', 'East'),
('PY', 'Puducherry', 'South'),
('PB', 'Punjab', 'North'),
('RJ', 'Rajasthan', 'North'),
('SK', 'Sikkim', 'Northeast'),
('TN', 'Tamil Nadu', 'South'),
('TS', 'Telangana', 'South'),
('TR', 'Tripura', 'Northeast'),
('UP', 'Uttar Pradesh', 'North'),
('UK', 'Uttarakhand', 'North'),
('WB', 'West Bengal', 'East');

-- ============================================================
-- OPERATOR ACCOUNTS
-- ============================================================
-- Intentionally no seeded user rows:
--   * Avoids shipping a known/default account in every deployment.
--   * Accounts must be provisioned out-of-band with backend/manage_users.py
--     using deployment-specific credentials.
