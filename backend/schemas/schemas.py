"""
MPLADS Sentinel — Pydantic Schemas (Request/Response)
"""

from __future__ import annotations
from datetime import date, datetime
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────────
# Canonical enums (shared contract with the frontend)
# ─────────────────────────────────────────────

class AuditorVerdict(str, Enum):
    """Canonical auditor verdict values.

    These are the single source of truth. The auditor portal dropdown in
    `frontend/app/anomalies/page.tsx` and this enum must stay in sync.
    Longest value is ``PENDING_INVESTIGATION`` (21 chars) — the
    ``RiskScore.auditor_verdict`` column is sized to fit.
    """

    VERIFIED = "VERIFIED"                    # Anomaly confirmed
    DISMISSED = "DISMISSED"                  # No irregularity found
    REFERRED = "REFERRED"                    # Escalated to higher authority
    PENDING_INVESTIGATION = "PENDING_INVESTIGATION"  # Needs further inquiry


# Legacy values accepted on input and normalised to the canonical enum so that
# any existing rows or external callers using the old vocabulary keep working.
_VERDICT_ALIASES: dict[str, AuditorVerdict] = {
    "CONFIRMED": AuditorVerdict.VERIFIED,
    "CLEARED": AuditorVerdict.DISMISSED,
}


# ─────────────────────────────────────────────
# Works
# ─────────────────────────────────────────────

class WorkBase(BaseModel):
    work_id: str
    work_id_source: Optional[str] = None
    official_work_ref: Optional[str] = None
    upstream_row: Optional[int] = None
    mp_id: Optional[str] = None
    mp_name: Optional[str] = None
    house: Optional[str] = None
    district_code: Optional[str] = None
    district_name: Optional[str] = None
    state_code: Optional[str] = None
    state_name: Optional[str] = None
    constituency_name: Optional[str] = None
    constituency_code: Optional[str] = None
    work_type: Optional[str] = None
    work_type_category: Optional[str] = None
    work_category: Optional[str] = None
    work_description: Optional[str] = None
    sanction_amount: Optional[float] = None
    release_amount: Optional[float] = None
    expenditure_amount: Optional[float] = None
    sanction_date: Optional[date] = None
    recommended_date: Optional[date] = None
    completion_date: Optional[date] = None
    reported_lat: Optional[float] = None
    reported_lon: Optional[float] = None
    coordinate_precision: Optional[str] = None
    contractor_gstin: Optional[str] = None
    implementing_agency: Optional[str] = None
    scheme_year: Optional[int] = None
    status: Optional[str] = None
    work_quantity: Optional[float] = None
    work_unit: Optional[str] = None
    city: Optional[str] = None
    ward: Optional[str] = None
    block: Optional[str] = None
    village: Optional[str] = None
    ida_approval: Optional[str] = None
    data_as_on: Optional[date] = None


class WorkResponse(WorkBase):
    risk_score: Optional["RiskScoreResponse"] = None
    model_config = {"from_attributes": True}


class WorkListItem(BaseModel):
    work_id: str
    work_id_source: Optional[str] = None
    official_work_ref: Optional[str] = None
    district_code: Optional[str] = None
    district_name: Optional[str] = None
    state_code: Optional[str] = None
    state_name: Optional[str] = None
    constituency_name: Optional[str] = None
    constituency_code: Optional[str] = None
    mp_id: Optional[str] = None
    mp_name: Optional[str] = None
    house: Optional[str] = None
    work_type: Optional[str] = None
    work_type_category: Optional[str] = None
    work_category: Optional[str] = None
    work_description: Optional[str] = None
    sanction_amount: Optional[float] = None
    sanction_date: Optional[date] = None
    recommended_date: Optional[date] = None
    completion_date: Optional[date] = None
    status: Optional[str] = None
    ida_approval: Optional[str] = None
    reported_lat: Optional[float] = None
    reported_lon: Optional[float] = None
    coordinate_precision: Optional[str] = None
    data_as_on: Optional[date] = None
    city: Optional[str] = None
    block: Optional[str] = None
    village: Optional[str] = None
    ward: Optional[str] = None
    implementing_agency: Optional[str] = None
    composite_score: Optional[float] = None
    confidence_tier: Optional[str] = None
    has_satellite_audit: bool = False
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────
# Risk Scores
# ─────────────────────────────────────────────

class SignalScore(BaseModel):
    score: float
    label: str
    evidence: str
    data_sources: list[str] = []


class RiskScoreResponse(BaseModel):
    work_id: str
    composite_score: float
    confidence_tier: Optional[str]
    isolation_score: float = 0.0
    satellite_score: float = 0.0
    weather_score: float = 0.0
    gstin_score: float = 0.0
    graph_score: float = 0.0
    cross_scheme_score: float = 0.0
    citizen_score: float = 0.0
    evidence_chain: Optional[dict[str, Any]] = None
    auditor_reviewed: bool = False
    auditor_verdict: Optional[AuditorVerdict] = None
    auditor_notes: Optional[str] = None
    scored_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class AuditorReviewRequest(BaseModel):
    verdict: AuditorVerdict = Field(..., description="Canonical verdict; legacy CONFIRMED/CLEARED are normalised.")
    notes: str = Field(..., min_length=10)

    @field_validator("verdict", mode="before")
    @classmethod
    def _normalise_legacy_verdict(cls, v: Any) -> Any:
        if isinstance(v, str):
            key = v.strip().upper()
            if key in _VERDICT_ALIASES:
                return _VERDICT_ALIASES[key]
            return key
        return v


# ─────────────────────────────────────────────
# Anomalies
# ─────────────────────────────────────────────

class AnomalyCard(BaseModel):
    work_id: str
    official_work_ref: Optional[str] = None
    district_name: Optional[str] = None
    district_code: Optional[str] = None
    state_code: Optional[str] = None
    constituency_name: Optional[str] = None
    work_type: Optional[str] = None
    work_description: Optional[str] = None
    sanction_amount: Optional[float] = None
    composite_score: float
    confidence_tier: str
    active_signals: list[str] = []
    # Always masked in L1/L2, revealed in L3 after review
    mp_id_masked: Optional[str] = None
    sanction_date: Optional[date] = None
    recommended_date: Optional[date] = None
    completion_date: Optional[date] = None


# ─────────────────────────────────────────────
# Contractors
# ─────────────────────────────────────────────

class ContractorResponse(BaseModel):
    gstin: str
    name: str
    city: Optional[str]
    state_code: Optional[str]
    gstin_status: Optional[str]
    registration_date: Optional[date]
    total_contracts: int = 0
    total_contract_value: float = 0.0
    risk_score: float = 0.0
    data_source: Optional[str] = None
    model_config = {"from_attributes": True}


class ContractorGraphData(BaseModel):
    nodes: list[dict[str, Any]]
    links: list[dict[str, Any]]
    # `available=False` distinguishes "analysed and found nothing" from "this
    # analysis was never run". An empty graph with no explanation is read by the
    # UI as a clean result, which would be the opposite of the truth.
    available: bool = True
    reason: Optional[str] = None


class ContractorCapabilityStatus(BaseModel):
    """Whether the vendor-network analysis can run in this deployment."""

    graph_available: bool
    clusters_available: bool
    reason: Optional[str] = None
    data_source: Optional[str] = None
    records: Optional[int] = None


# ─────────────────────────────────────────────
# Satellite
# ─────────────────────────────────────────────

class SatelliteCheckResponse(BaseModel):
    check_id: int
    work_id: str
    date_before: Optional[date]
    date_after: Optional[date]
    ndbi_change: Optional[float]
    ndvi_change: Optional[float]
    change_score: Optional[float]
    satellite_flag: bool
    confidence: Optional[float]
    cloud_coverage_pct: Optional[float]
    imagery_before_url: Optional[str]
    imagery_after_url: Optional[str]
    thumbnail_before_url: Optional[str]
    thumbnail_after_url: Optional[str]
    notes: Optional[str]
    model_config = {"from_attributes": True}


class SatelliteTriggerRequest(BaseModel):
    work_id: str


# ─────────────────────────────────────────────
# Citizen Reports
# ─────────────────────────────────────────────

class CitizenReportCreate(BaseModel):
    work_id: str
    report_lat: float = Field(..., ge=-90, le=90)
    report_lon: float = Field(..., ge=-180, le=180)
    construction_visible: bool
    work_complete: bool
    matches_board_description: bool
    quality_rating: int = Field(..., ge=1, le=5)
    comments: Optional[str] = Field(default=None, max_length=4000)


class CitizenReportResponse(BaseModel):
    report_id: UUID
    work_id: str
    report_lat: Optional[float] = None
    report_lon: Optional[float] = None
    construction_visible: bool
    work_complete: bool
    matches_board_description: bool
    quality_rating: int
    comments: Optional[str] = None
    photo_url: Optional[str] = None
    distance_from_work_m: Optional[float] = None
    submitted_at: datetime
    verified: bool
    # The submitting account, exposed only on the AUDITOR/ADMIN read routes that
    # serve this schema. The submitter's own POST response omits it deliberately,
    # so a client cannot read it back out of its own submission.
    reporter_username: Optional[str] = Field(
        default=None,
        description="Populated on auditor-facing reads only.",
    )
    attachment_count: int = Field(
        default=0, description="Evidence files recorded against this report."
    )
    model_config = {"from_attributes": True}


class EvidenceAttachmentResponse(BaseModel):
    attachment_id: UUID
    original_filename: str
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    uploaded_by: Optional[str] = None
    uploaded_at: datetime
    model_config = {"from_attributes": True}


class CitizenDemandCreate(BaseModel):
    """A citizen's request for a new work.

    There is no `status`, `sanctioned_at` or order-number field on purpose: a
    request is not an approval, and accepting one of those from the client would
    let a caller assert that their own request had been sanctioned.
    """

    submitted_by_name: Optional[str] = Field(default=None, max_length=200)
    contact_phone: Optional[str] = Field(default=None, max_length=20)
    contact_email: Optional[str] = Field(default=None, max_length=200)
    state_code: Optional[str] = Field(default=None, max_length=2)
    district_name: Optional[str] = Field(default=None, max_length=100)
    constituency_name: Optional[str] = Field(default=None, max_length=150)
    village: Optional[str] = Field(default=None, max_length=150)
    work_category: Optional[str] = Field(default=None, max_length=60)
    work_title: str = Field(..., min_length=5, max_length=500)
    description: Optional[str] = Field(default=None, max_length=8000)
    estimated_amount: Optional[float] = Field(default=None, ge=0)


class DemandAcknowledgement(BaseModel):
    """Receipt for a registered request.

    ``acknowledgement_ref`` is this portal's own id. ``notice`` states the limit
    of what the reference means, and the UI must display it.
    """

    demand_id: str
    acknowledgement_ref: str
    status: str
    submitted_at: datetime
    attachment_count: int = 0
    notice: str


class CitizenDemandResponse(BaseModel):
    demand_id: UUID
    acknowledgement_ref: str
    submitted_by: str
    submitted_by_name: Optional[str] = None
    state_code: Optional[str] = None
    district_name: Optional[str] = None
    constituency_name: Optional[str] = None
    village: Optional[str] = None
    work_category: Optional[str] = None
    work_title: str
    description: Optional[str] = None
    estimated_amount: Optional[float] = None
    routed_to_role: Optional[str] = None
    routed_at: Optional[datetime] = None
    status: str
    decision_note: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────
# MP
# ─────────────────────────────────────────────

class MPProfile(BaseModel):
    mp_id: str
    full_name: str
    party: Optional[str]
    state_code: Optional[str]
    total_works: int = 0
    total_allocation: float = 0.0
    total_spent: float = 0.0
    utilization_pct: float = 0.0
    l3_flags: int = 0
    l2_flags: int = 0
    top_contractors: list[dict] = []
    model_config = {"from_attributes": True}


class LapseForecastResponse(BaseModel):
    district_code: str
    mp_id: Optional[str]
    fiscal_year: int
    allocated_amount: float
    spent_to_date: float
    projected_lapse: float
    lapse_probability: float
    lapse_tier: str
    days_remaining: int
    forecast_data: Optional[list[dict]] = None
    nudge_sent: bool = False
    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────
# Audit Note
# ─────────────────────────────────────────────

class AuditNoteResponse(BaseModel):
    work_id: str
    generated_at: datetime
    draft_note: str
    model_used: str
    disclaimer: str = (
        "DRAFT — This note is AI-generated and requires review by a qualified "
        "audit officer before any official action."
    )


# ─────────────────────────────────────────────
# Admin
# ─────────────────────────────────────────────

class PipelineStatusResponse(BaseModel):
    status: str
    last_scrape: Optional[datetime]
    last_ml_run: Optional[datetime]
    works_scored: int
    l3_count: int
    l2_count: int
    l1_count: int


# ─────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    expires_at: datetime
    expires_in_minutes: int


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=256)


class UserProfileResponse(BaseModel):
    """The account behind an access token. Mirrors `models.models.User`."""

    user_id: str
    username: str
    email: str
    full_name: Optional[str] = None
    role: str
    state_code: Optional[str] = None
    district_name: Optional[str] = None
    constituency_name: Optional[str] = None
    mp_id: Optional[str] = None
    is_active: bool = True
    last_login: Optional[datetime] = None


# ─────────────────────────────────────────────
# Notifications
# ─────────────────────────────────────────────

class NotificationMessage(BaseModel):
    """An operator-published event for the SSE bus.

    ``severity`` is constrained to a fixed set so a caller cannot inject an
    arbitrary level, and ``target_roles`` makes delivery scope explicit instead
    of pushing every event to every connected screen.
    """

    category: str = Field(..., max_length=60)
    title: str = Field(..., max_length=200)
    description: str = Field(..., max_length=2000)
    target_id: str = Field(default="ALL", max_length=100)
    severity: str = Field(default="INFO", pattern="^(INFO|WARNING|CRITICAL|SUCCESS)$")
    timestamp: str = ""
    target_roles: list[str] = Field(default_factory=list)

    def is_broadcast(self) -> bool:
        """True when no specific audience was named, i.e. deliver to everyone.

        An empty ``target_roles`` is an intentional publish-to-all. A non-empty
        list is a scope, and only subscribers holding one of those roles get the
        event.
        """
        return not self.recipients()

    def recipients(self) -> set[str]:
        """Normalised roles this event is addressed to.

        Returns an empty set for a publish-to-all event; callers must use
        :meth:`is_broadcast` to distinguish "everyone" from "nobody", since an
        empty set is otherwise ambiguous.
        """
        roles: set[str] = set()
        for role in self.target_roles:
            normalised = role.strip().upper()
            # PUBLIC is the anonymous class, not a role an account can hold, so
            # it is not a valid addressing target. "ALL" is expressed by
            # leaving the list empty.
            if normalised and normalised not in {"PUBLIC", "ALL"}:
                roles.add(normalised)
        return roles
