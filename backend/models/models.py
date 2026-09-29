"""
MPLADS Sentinel — SQLAlchemy ORM Models
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    ARRAY, Boolean, CheckConstraint, Column, Date, DateTime, Float, ForeignKey,
    Integer, Numeric, String, Text, func
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, INET
from sqlalchemy.orm import relationship
from database import Base


class State(Base):
    __tablename__ = "states"
    state_code = Column(String(2), primary_key=True)
    state_name = Column(String(100), nullable=False)
    region = Column(String(50))


class District(Base):
    __tablename__ = "districts"
    district_code = Column(String(10), primary_key=True)
    district_name = Column(String(100), nullable=False)
    state_code = Column(String(2), ForeignKey("states.state_code"))
    latitude = Column(Float)
    longitude = Column(Float)
    population = Column(Integer)
    area_sq_km = Column(Float)
    secc_deprivation_score = Column(Float)


class MP(Base):
    __tablename__ = "mps"
    mp_id = Column(String(20), primary_key=True)
    full_name = Column(String(200), nullable=False)
    party = Column(String(100))
    constituency_code = Column(String(10))
    state_code = Column(String(2), ForeignKey("states.state_code"))
    term_start = Column(Date)
    term_end = Column(Date)
    is_active = Column(Boolean, default=True)
    # Nullable, and deliberately WITHOUT a default.
    # MPLADS allocations are not a single statutory figure: they are set per
    # state/UT and revised by the Ministry, and the correct number changes
    # over time. The previous `default=50000000` meant every MP row created
    # without an explicit allocation silently carried a fabricated ₹5 Cr,
    # which was then divided into a headline "utilisation %" on the MP
    # dashboard. A missing allocation must stay missing so it is reported as
    # unavailable rather than invented.
    annual_allocation = Column(Numeric(15, 2), nullable=True)
    email = Column(String(200))
    phone = Column(String(20))
    created_at = Column(DateTime, default=datetime.utcnow)
    works = relationship("Work", back_populates="mp")


class Contractor(Base):
    __tablename__ = "contractors"
    gstin = Column(String(20), primary_key=True)
    name = Column(String(300), nullable=False)
    address = Column(Text)
    city = Column(String(100))
    state_code = Column(String(2), ForeignKey("states.state_code"))
    registration_date = Column(Date)
    gstin_status = Column(String(20))
    director_names = Column(ARRAY(Text))
    phone_numbers = Column(ARRAY(Text))
    total_contracts = Column(Integer, default=0)
    total_contract_value = Column(Numeric(20, 2), default=0)
    risk_score = Column(Float, default=0.0)
    last_gstin_check = Column(DateTime)
    # Which dataset this row came from. A contractor aggregate derived from
    # open-published tender data is not the same thing as one from a sanctioned
    # MoSPI register, and the UI must be able to say which.
    data_source = Column(String(60))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    works = relationship("Work", back_populates="contractor")


class Work(Base):
    """A single MPLADS work.

    The columns split into two groups:

    * `SANSAD_*` / `*_source` / `coord_*` describe *identity and provenance* and
      come straight from the open MPLADS feed
      (github.com/vonter/india-mplads-works, ODbL). They exist because the feed
      is the authority on what a work is, and the portal must be able to show
      the upstream values without re-deriving them.
    * everything else is the internal model used for filtering, scoring and
      reporting. `work_type` is the scheme's own sector category, not a keyword
      guess.

    Columns with no real source stay NULL. Nothing in this table is defaulted to
    a plausible-looking number, because every figure here is displayed to
    oversight bodies as if it were factual.
    """

    __tablename__ = "works"
    work_id = Column(String(64), primary_key=True)
    mp_id = Column(String(20), ForeignKey("mps.mp_id"))
    district_code = Column(String(10), ForeignKey("districts.district_code"))
    district_name = Column(String(100))
    state_code = Column(String(2), ForeignKey("states.state_code"))
    work_type = Column(String(50), nullable=False)
    work_type_category = Column(String(50))
    work_description = Column(Text)
    sanction_amount = Column(Numeric(15, 2))
    release_amount = Column(Numeric(15, 2))
    expenditure_amount = Column(Numeric(15, 2))
    sanction_date = Column(Date)
    completion_date = Column(Date)
    reported_lat = Column(Float)
    reported_lon = Column(Float)
    contractor_gstin = Column(String(20), ForeignKey("contractors.gstin"))
    implementing_agency = Column(String(200))
    scheme_year = Column(Integer)
    status = Column(String(30))
    work_quantity = Column(Float)
    work_unit = Column(String(20))

    # ── Upstream feed columns (data/output/works_real.csv) ────────────────────
    # `work_id` is the only key, but MPLADS publishes no identifier for every
    # work, so this records *how* a given row's key was obtained:
    #   'OFFICIAL' — the feed contained a real reference (e.g. WS/MP521/2023-2024/3061)
    #   'DERIVED'  — no reference exists upstream; the key is a SHA-1 surrogate
    # A DERIVED key must never be shown as an official MPLADS reference.
    work_id_source = Column(String(10))
    official_work_ref = Column(String(100), index=True)
    upstream_row = Column(Integer)
    mp_name = Column(String(200))
    house = Column(String(20))
    constituency_name = Column(String(200))
    constituency_code = Column(String(10))
    state_name = Column(String(100))
    work_category = Column(String(60))
    city = Column(String(100))
    # The public feed sometimes stores full ward/locality descriptions here,
    # not a short ward number; retain the source value without truncation.
    ward = Column(Text)
    block = Column(String(100))
    village = Column(String(150))
    recommended_date = Column(Date)
    ida_approval = Column(String(60))
    # How the stored lat/lon was obtained. The open feed has no surveyed
    # coordinates, so the only value that may appear here is a place centroid
    # ('CENTROID'), never a work GPS fix.
    coordinate_precision = Column(String(20))
    data_as_on = Column(Date)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    mp = relationship("MP", back_populates="works")
    contractor = relationship("Contractor", back_populates="works")
    risk_score = relationship("RiskScore", back_populates="work", uselist=False)
    satellite_checks = relationship("SatelliteCheck", back_populates="work")
    citizen_reports = relationship("CitizenReport", back_populates="work")


class RiskScore(Base):
    __tablename__ = "risk_scores"
    score_id = Column(Integer, primary_key=True, autoincrement=True)
    work_id = Column(String(64), ForeignKey("works.work_id"), unique=True)
    isolation_score = Column(Float, default=0.0)
    satellite_score = Column(Float, default=0.0)
    weather_score = Column(Float, default=0.0)
    gstin_score = Column(Float, default=0.0)
    graph_score = Column(Float, default=0.0)
    cross_scheme_score = Column(Float, default=0.0)
    citizen_score = Column(Float, default=0.0)
    composite_score = Column(Float, default=0.0)
    confidence_tier = Column(String(2))
    model_version = Column(String(20), default="1.0.0")
    evidence_chain = Column(JSONB)
    auditor_reviewed = Column(Boolean, default=False)
    auditor_id = Column(String(50))
    # The role the reviewing account held when the verdict was recorded. Without
    # this a later viewer cannot tell an auditor verdict from an admin one, and
    # the role cannot be derived from the account after it has been re-provisioned.
    reviewed_by_role = Column(String(30))
    # Sized to fit the longest canonical verdict, PENDING_INVESTIGATION (21 chars).
    auditor_verdict = Column(String(32))
    auditor_notes = Column(Text)
    reviewed_at = Column(DateTime)
    scored_at = Column(DateTime, default=datetime.utcnow)
    work = relationship("Work", back_populates="risk_score")


class CrossSchemeMatch(Base):
    __tablename__ = "cross_scheme_matches"
    match_id = Column(Integer, primary_key=True, autoincrement=True)
    work_id_mplads = Column(String(64), ForeignKey("works.work_id"))
    work_id_other = Column(String(100), nullable=False)
    other_scheme = Column(String(50), nullable=False)
    other_scheme_amount = Column(Numeric(15, 2))
    similarity_score = Column(Float, nullable=False)
    match_basis = Column(ARRAY(Text))
    match_distance_m = Column(Float)
    description_similarity = Column(Float)
    flagged_at = Column(DateTime, default=datetime.utcnow)


class SatelliteCheck(Base):
    __tablename__ = "satellite_checks"
    check_id = Column(Integer, primary_key=True, autoincrement=True)
    work_id = Column(String(64), ForeignKey("works.work_id"))
    check_date = Column(DateTime, default=datetime.utcnow)
    date_before = Column(Date)
    date_after = Column(Date)
    ndbi_change = Column(Float)
    ndvi_change = Column(Float)
    change_score = Column(Float)
    satellite_flag = Column(Boolean, default=False)
    confidence = Column(Float)
    cloud_coverage_pct = Column(Float)
    imagery_before_url = Column(Text)
    imagery_after_url = Column(Text)
    thumbnail_before_url = Column(Text)
    thumbnail_after_url = Column(Text)
    sentinel_tile_id = Column(String(50))
    model_version = Column(String(20))
    notes = Column(Text)
    work = relationship("Work", back_populates="satellite_checks")


class CitizenReport(Base):
    """A citizen's ground-truth observation of an existing work."""

    __tablename__ = "citizen_reports"
    report_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_id = Column(String(64), ForeignKey("works.work_id"))
    # The submitting account. Nullable because pre-migration rows predate the
    # users table; new submissions always set it.
    reporter_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL")
    )
    report_lat = Column(Float)
    report_lon = Column(Float)
    construction_visible = Column(Boolean)
    work_complete = Column(Boolean)
    matches_board_description = Column(Boolean)
    quality_rating = Column(Integer)
    comments = Column(Text)
    photo_url = Column(Text)
    distance_from_work_m = Column(Float)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    verified = Column(Boolean, default=False)
    verified_by = Column(String(50))
    verified_at = Column(DateTime)
    work = relationship("Work", back_populates="citizen_reports")
    attachments = relationship(
        "EvidenceAttachment", back_populates="report", cascade="all, delete-orphan"
    )


class EvidenceAttachment(Base):
    """A file a citizen attached as evidence for a report or a demand.

    The file itself lives on disk under ``settings.UPLOAD_DIR``; this row is the
    only record of it. ``storage_key`` is a server-generated relative path —
    the original filename is kept in ``original_filename`` for display and is
    never used to build a path, so a crafted name cannot escape the upload
    directory.
    """
    __tablename__ = "evidence_attachments"

    attachment_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Exactly one owner. Without this an attachment could be counted against
    # both a report and a demand, and deleting one would cascade-remove a file
    # the other still references. The application enforces it on insert; the
    # constraint below makes the database agree.
    __table_args__ = (
        CheckConstraint(
            "(report_id IS NOT NULL AND demand_id IS NULL) "
            "OR (report_id IS NULL AND demand_id IS NOT NULL)",
            name="ck_evidence_exactly_one_parent",
        ),
    )
    report_id = Column(
        UUID(as_uuid=True), ForeignKey("citizen_reports.report_id", ondelete="CASCADE")
    )
    demand_id = Column(
        UUID(as_uuid=True), ForeignKey("citizen_demands.demand_id", ondelete="CASCADE")
    )
    original_filename = Column(String(255), nullable=False)
    storage_key = Column(Text, nullable=False)
    content_type = Column(String(100))
    size_bytes = Column(Integer)
    sha256 = Column(String(64))
    uploaded_by = Column(String(100))
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    report = relationship("CitizenReport", back_populates="attachments")
    demand = relationship("CitizenDemand", back_populates="attachments")


class CitizenDemand(Base):
    """A citizen request for a new work, submitted through the portal.

    This replaces the previous browser-only "demand" flow, which kept records
    in ``localStorage`` and simulated the whole government chain: an MP
    "endorsement" and a district "sanction" that minted a fabricated
    ``SO-KAN-<digits>`` order number and a fake PFMS UTR. Nothing was
    transmitted to any office and no order existed.

    What this table records is deliberately narrower: that a request was
    received, who sent it, its evidence, and the acknowledgement state. It does
    **not** issue a sanction order and it does not carry a government order
    number — see :attr:`acknowledgement_ref`, which is this system's own
    receipt id and is labelled as such wherever it is displayed.
    """

    __tablename__ = "citizen_demands"

    demand_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Human-facing receipt id for this portal. NOT a government sanction order
    # number, and never prefixed to look like one.
    acknowledgement_ref = Column(String(32), unique=True, nullable=False)

    submitted_by = Column(String(100), nullable=False)
    submitted_by_name = Column(String(200))
    contact_phone = Column(String(20))
    contact_email = Column(String(200))

    state_code = Column(String(2))
    district_name = Column(String(100))
    constituency_name = Column(String(150))
    village = Column(String(150))

    work_category = Column(String(60))
    work_title = Column(Text, nullable=False)
    description = Column(Text)
    estimated_amount = Column(Numeric(15, 2))
    # Set when the request has been routed to a reviewing office. This records
    # the *portal's* routing, not a decision by any office.
    routed_to_role = Column(String(30))
    routed_at = Column(DateTime)

    status = Column(String(30), default="RECEIVED", nullable=False)
    decision_note = Column(Text)
    decided_by = Column(String(100))
    decided_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)
    attachments = relationship(
        "EvidenceAttachment", back_populates="demand", cascade="all, delete-orphan"
    )


class LapseForecast(Base):
    __tablename__ = "lapse_forecasts"
    forecast_id = Column(Integer, primary_key=True, autoincrement=True)
    district_code = Column(String(10), ForeignKey("districts.district_code"))
    mp_id = Column(String(20), ForeignKey("mps.mp_id"))
    fiscal_year = Column(Integer)
    forecast_date = Column(Date)
    allocated_amount = Column(Numeric(15, 2))
    spent_to_date = Column(Numeric(15, 2))
    prophet_forecast = Column(Numeric(15, 2))
    projected_lapse = Column(Numeric(15, 2))
    lapse_probability = Column(Float)
    lapse_tier = Column(String(10))
    forecast_data = Column(JSONB)
    nudge_sent = Column(Boolean, default=False)
    nudge_sent_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class QuarterlyExpenditure(Base):
    __tablename__ = "quarterly_expenditure"
    exp_id = Column(Integer, primary_key=True, autoincrement=True)
    district_code = Column(String(10), ForeignKey("districts.district_code"))
    mp_id = Column(String(20), ForeignKey("mps.mp_id"))
    fiscal_year = Column(Integer)
    quarter = Column(Integer)
    allocated_amount = Column(Numeric(15, 2))
    spent_amount = Column(Numeric(15, 2))
    works_sanctioned = Column(Integer)
    works_completed = Column(Integer)
    cumulative_spent = Column(Numeric(15, 2))
    created_at = Column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    log_id = Column(Integer, primary_key=True, autoincrement=True)
    action = Column(String(100), nullable=False)
    actor = Column(String(100))
    entity_type = Column(String(50))
    entity_id = Column(String(100))
    old_value = Column(JSONB)
    new_value = Column(JSONB)
    ip_address = Column(INET)
    user_agent = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)


class User(Base):
    """An operator of the portal.

    This table was previously never written to, and the API never consulted it,
    so authentication was in name only. It is now the sole source of truth for
    role and jurisdiction: :func:`backend.auth.principal_from_token` re-reads the
    role on every request so a deactivation takes effect immediately.

    Jurisdiction columns are nullable and *meaningful*: an MP or District
    Authority account with no state provisioned is denied out-of-state access
    rather than defaulting to national scope.
    """

    __tablename__ = "users"
    user_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(100), unique=True, nullable=False)
    email = Column(String(200), unique=True, nullable=False)
    # PBKDF2-HMAC-SHA256 encoded hash, e.g. "$pbkdf2-sha256$290000$<salt>$<dk>".
    # Sized for the full encoded string, which is ~120 characters.
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(200))
    role = Column(String(30), nullable=False)
    jurisdiction_state = Column(String(2))
    district_name = Column(String(100))
    constituency_name = Column(String(150))
    mp_id = Column(String(20))
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
