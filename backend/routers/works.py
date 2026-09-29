"""
MPLADS Sentinel â€” Works Router

Every response field here is optional except ``work_id``. That is not laxity: it
reflects what the open MPLADS feed actually publishes. A record may have no
district, no sanction date, no coordinates and no MP match, and the portal has
to be able to say so instead of inventing a value to satisfy a required field.

Authentication split
--------------------
* ``GET /works/`` and ``GET /works/{work_id}`` are published oversight data and
  stay readable without a login (the portal is public-facing), but they are
  still attributed when a token is supplied.
* ``GET /works/{work_id}/audit-note`` returns LLM text attributed to a work and
  requires an AUDITOR/ADMIN token.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

# `status` is imported under an alias on purpose: this module already has a
# query parameter called `status` (see list_works), which would otherwise shadow
# the `fastapi.status` module and turn `status.HTTP_400_BAD_REQUEST` into an
# AttributeError on a string -- a 500 where a 400 was meant.
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload
from auth import ROLES_AUDIT, Principal, require_roles, viewer, write_audit_log
from database import get_db
from ml_catalog_loader import (
    context_rules_for,
    has_unevaluated,
    matched_rules_for,
    not_computed,
)
from models.models import RiskScore, SatelliteCheck, Work
from schemas.schemas import (
    AuditNoteResponse,
    RiskScoreResponse,
    WorkListItem,
    WorkResponse,
)
from services.audit_note_service import audit_note_service

router = APIRouter()
STATE_CODE_ALIASES: dict[str, list[str]] = {
    "OD": ["OD", "OR"],
    "OR": ["OD", "OR"],
    "TG": ["TG", "TS"],
    "TS": ["TG", "TS"],
    "CG": ["CG", "CT"],
    "CT": ["CG", "CT"],
    "UT": ["UT", "UK"],
    "UK": ["UT", "UK"],
}

def _resolve_state_codes(code: str) -> list[str]:
    c = code.strip().upper()
    return STATE_CODE_ALIASES.get(c, [c])


# Columns needed to build a WorkListItem. Selecting them explicitly (rather
# than `select(Work)`) keeps the list response from pulling every heavy column.
_LIST_COLUMNS = (
    Work.work_id,
    Work.work_id_source,
    Work.official_work_ref,
    Work.district_code,
    Work.district_name,
    Work.state_code,
    Work.state_name,
    Work.constituency_name,
    Work.constituency_code,
    Work.mp_id,
    Work.mp_name,
    Work.house,
    Work.work_type,
    Work.work_type_category,
    Work.work_category,
    Work.work_description,
    Work.sanction_amount,
    Work.sanction_date,
    Work.recommended_date,
    Work.completion_date,
    Work.status,
    Work.ida_approval,
    Work.reported_lat,
    Work.reported_lon,
    Work.coordinate_precision,
    Work.data_as_on,
    Work.city,
    Work.block,
    Work.village,
    Work.ward,
    Work.implementing_agency,
)


def _as_float(value) -> Optional[float]:
    return float(value) if value is not None else None


# Next's rewrite normalizes API paths without a trailing slash. Accept both
# forms so that the frontend proxy cannot turn the documented slash form into
# a FastAPI 307 redirect loop.
@router.get("", response_model=list[WorkListItem], include_in_schema=False)
@router.get("/", response_model=list[WorkListItem])
async def list_works(
    state_code: Optional[str] = None,
    district_code: Optional[str] = None,
    district_name: Optional[str] = None,
    constituency_code: Optional[str] = None,
    mp_id: Optional[str] = None,
    work_type: Optional[str] = None,
    tier: Optional[str] = None,
    min_score: Optional[float] = None,
    status: Optional[str] = None,
    scheme_year: Optional[int] = None,
    search: Optional[str] = None,
    has_satellite_audit: Optional[bool] = None,
    has_coordinates: Optional[bool] = None,
    official_id_only: Optional[bool] = None,
    sort: str = "risk_desc",
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=500),
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """List works with optional filters. Includes risk scores when available.

    `search` is applied server-side on purpose. Previously the frontend
    filtered only the rows already loaded into the current page, so a search
    could never find a work that was on page 2.
    """
    satellite_exists = exists(
        select(SatelliteCheck.work_id).where(SatelliteCheck.work_id == Work.work_id)
    )

    q = (
        select(
            *_LIST_COLUMNS,
            RiskScore.composite_score,
            RiskScore.confidence_tier,
            satellite_exists.label("has_satellite_audit"),
        )
        .outerjoin(RiskScore, Work.work_id == RiskScore.work_id)
    )

    filters = []
    if state_code:
        filters.append(func.upper(Work.state_code).in_(_resolve_state_codes(state_code)))
    if district_code:
        filters.append(Work.district_code == district_code)
    if district_name:
        # Added because accounts are provisioned with a district *name* while
        # the works table is also indexed by district *code*. The district desk
        # previously filtered client-side, so it showed whichever rows the
        # unfiltered request happened to return, in a state, rather than the
        # district's own works.
        #
        # Exact, case-insensitive, with the wildcards escaped out of the value.
        # This was `ilike("%<name>%")`, a substring match: it also matched
        # Kannauj -> "Kannauj", but "Balrampur" -> every district whose name
        # merely contains it, and a name carrying `%` or `_` was interpreted as
        # a pattern, so `district_name="_"` matched every district in the state.
        # A district is an administrative unit, not a search term: the register
        # should either contain that district or not.
        filters.append(
            func.lower(Work.district_name) == district_name.strip().lower()
        )
        if not state_code:
            # District names repeat between states, so a name alone cannot
            # identify the district the caller meant. Refusing beats answering
            # with a mixed list that silently includes same-named districts from
            # other states. This mirrors the fail-closed rule in the demand
            # queue's `_scope_demands`, where the same argument applied.
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    "district_name must be sent together with state_code. District names "
                    "are not unique across India, so a name on its own cannot identify "
                    "the district being asked for."
                ),
            )
    # Added so the MP dashboard can scope to its own constituency. The frontend
    # previously called fetchWorks({limit: 8}) and displayed whichever eight
    # works the database happened to return, which is why the MP page could show
    # works from a different constituency than the MP whose profile it claimed.
    if constituency_code:
        filters.append(Work.constituency_code == constituency_code)
    if mp_id:
        filters.append(Work.mp_id == mp_id)
    if work_type:
        filters.append(func.lower(Work.work_type) == work_type.strip().lower())
    if tier:
        filters.append(RiskScore.confidence_tier == tier)
    if status:
        filters.append(func.lower(Work.status) == status.strip().lower())
    if scheme_year:
        filters.append(Work.scheme_year == scheme_year)
    if min_score is not None:
        filters.append(RiskScore.composite_score >= min_score)
    if has_satellite_audit is True:
        filters.append(satellite_exists.is_(True))
    elif has_satellite_audit is False:
        filters.append(satellite_exists.is_(False))
    if has_coordinates is True:
        filters.append(and_(Work.reported_lat.isnot(None), Work.reported_lon.isnot(None)))
    elif has_coordinates is False:
        filters.append(or_(Work.reported_lat.is_(None), Work.reported_lon.is_(None)))
    if official_id_only is True:
        # The map and the "official reference" column must only ever show works
        # whose identifier really came from the feed.
        filters.append(Work.official_work_ref.isnot(None))
    if search:
        term = f"%{search.strip()}%"
        filters.append(
            or_(
                Work.work_id.ilike(term),
                Work.official_work_ref.ilike(term),
                Work.work_description.ilike(term),
                Work.district_name.ilike(term),
                Work.district_code.ilike(term),
                Work.constituency_name.ilike(term),
                Work.state_name.ilike(term),
                Work.state_code.ilike(term),
                Work.village.ilike(term),
                Work.block.ilike(term),
                Work.city.ilike(term),
                Work.mp_name.ilike(term),
                Work.implementing_agency.ilike(term),
                Work.work_type.ilike(term),
            )
        )

    if filters:
        q = q.where(and_(*filters))

    if sort == "date_desc":
        q = q.order_by(Work.sanction_date.desc().nulls_last())
    elif sort == "amount_desc":
        q = q.order_by(Work.sanction_amount.desc().nulls_last())
    else:
        # Default: highest composite risk first. Unscored works sink to the
        # bottom rather than being treated as zero risk.
        q = q.order_by(RiskScore.composite_score.desc().nulls_last())

    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    rows = result.all()

    return [
        WorkListItem(
            work_id=r.work_id,
            work_id_source=r.work_id_source,
            official_work_ref=r.official_work_ref,
            district_code=r.district_code,
            district_name=r.district_name,
            state_code=r.state_code,
            state_name=r.state_name,
            constituency_name=r.constituency_name,
            constituency_code=r.constituency_code,
            mp_id=r.mp_id,
            mp_name=r.mp_name,
            house=r.house,
            work_type=r.work_type,
            work_type_category=r.work_type_category,
            work_category=r.work_category,
            work_description=r.work_description,
            sanction_amount=_as_float(r.sanction_amount),
            sanction_date=r.sanction_date,
            recommended_date=r.recommended_date,
            completion_date=r.completion_date,
            status=r.status,
            ida_approval=r.ida_approval,
            reported_lat=r.reported_lat,
            reported_lon=r.reported_lon,
            coordinate_precision=r.coordinate_precision,
            data_as_on=r.data_as_on,
            city=r.city,
            block=r.block,
            village=r.village,
            ward=r.ward,
            implementing_agency=r.implementing_agency,
            composite_score=r.composite_score,
            confidence_tier=r.confidence_tier,
            has_satellite_audit=bool(r.has_satellite_audit),
        )
        for r in rows
    ]


@router.get("/{work_id}", response_model=WorkResponse)
async def get_work(
    work_id: str,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get single work with full detail and risk score evidence chain."""
    result = await db.execute(
        select(Work).options(selectinload(Work.risk_score)).where(Work.work_id == work_id)
    )
    work = result.scalar_one_or_none()
    if not work:
        raise HTTPException(status_code=404, detail=f"Work {work_id} not found")

    risk = work.risk_score

    response = WorkResponse.model_validate(work)
    response.risk_score = RiskScoreResponse.model_validate(risk) if risk else None
    # The catalog rules that matched, and the analyses that could not run, travel
    # with the work. A detail page previously asked the client to explain the
    # signals from a hardcoded map, so the explanation could assert measurements
    # the scoring pass never made.
    response.matched_rules = matched_rules_for(risk.evidence_chain if risk else None)
    response.context_rules = context_rules_for(risk.evidence_chain if risk else None)
    response.not_computed = not_computed()
    response.incomplete_evaluation = has_unevaluated(risk.evidence_chain if risk else None)
    return response


@router.get("/{work_id}/audit-note", response_model=AuditNoteResponse)
async def get_audit_note(
    work_id: str,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Generate an LLM audit note for a work. Requires L2+ tier.

    Restricted to AUDITOR/ADMIN: this endpoint produces text that an audit
    officer may quote, so it was previously reachable by any anonymous caller
    and its output attributed to no one. Access is written to the audit log
    against the authenticated caller.
    """
    result = await db.execute(select(Work).where(Work.work_id == work_id))
    work = result.scalar_one_or_none()
    if not work:
        raise HTTPException(404, f"Work {work_id} not found")

    score_result = await db.execute(
        select(RiskScore).where(RiskScore.work_id == work_id)
    )
    risk = score_result.scalar_one_or_none()
    if not risk or risk.confidence_tier not in ('L2', 'L3'):
        raise HTTPException(403, "Audit notes are only generated for L2/L3 flags")

    work_details = {
        "work_description": work.work_description,
        "sanction_amount": float(work.sanction_amount or 0),
        "district_name": work.district_name or work.district_code,
        "constituency_name": work.constituency_name,
        "state_code": work.state_code,
        "work_type": work.work_type,
        "sanction_date": str(work.sanction_date),
        "recommended_date": str(work.recommended_date),
        "completion_date": str(work.completion_date),
    }
    risk_score_data = {
        "composite_score": risk.composite_score,
        "confidence_tier": risk.confidence_tier,
        "isolation_score": risk.isolation_score,
    }

    note = await audit_note_service.generate(
        work_id, work_details, risk_score_data, risk.evidence_chain or {}
    )

    await write_audit_log(
        db,
        principal,
        action="work.audit_note.generated",
        entity_type="work",
        entity_id=work_id,
    )
    await db.commit()

    return AuditNoteResponse(
        work_id=work_id,
        generated_at=datetime.utcnow(),
        draft_note=note,
        model_used="gemini-1.5-pro" if bool(risk.evidence_chain) else "template",
    )
