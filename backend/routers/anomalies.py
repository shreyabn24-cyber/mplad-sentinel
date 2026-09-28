"""
MPLADS Sentinel Ã¢â‚¬â€ Anomalies Router

Access model
------------
* The anomaly list and the tier summary are published oversight information and
  remain readable anonymously.
* The MP identity is masked in the public list **at every tier, including L3**.
  This is a design decision taken in this codebase, not a legal requirement: the
  docstring below used to call it "a legal safeguard" and claim the tiers were
  "cleared to disclose" as though an instrument established that, which none
  does. More concretely, the masking was applied only to L1/L2, so an anonymous
  caller reading the public list received the unmasked MP id for every L3 row
  and the "safeguard" was a hole exactly where the accusation was most serious.
  A public list now masks uniformly; identity is disclosed by the audit-gated
  ``/l3/`` endpoint instead.
* ``/l3/`` reveals the unmasked MP identity and is restricted to AUDITOR/ADMIN.
  It previously served that field to any anonymous caller.
* ``POST /{work_id}/review`` writes an audit verdict, so it is restricted to
  AUDITOR/ADMIN and the ``AuditLog`` row records the authenticated username
  instead of the literal string ``"SYSTEM"``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import ROLES_AUDIT, Principal, require_roles, viewer
from database import get_db
from models.models import AuditLog, LapseForecast, RiskScore, Work
from schemas.schemas import AnomalyCard, AuditorReviewRequest

router = APIRouter()


def _mask_mp_id(mp_id: Optional[str], tier: str) -> Optional[str]:
    """Mask the MP identity in a publicly readable response.

    ``tier`` is accepted for call-site readability but deliberately unused: this
    masked L1 and L2 and passed L3 through raw, which meant the anonymous public
    list disclosed the full identity of the MP behind every L3 flag. There is no
    argument for publishing a name only in the most serious tier, so the tier
    distinction is gone. Identity is available from the AUDITOR/ADMIN-only
    ``/l3/`` endpoint.

    A design choice in this codebase, not a legal requirement Ã¢â‚¬â€ an earlier
    version of this docstring claimed it was "a legal safeguard" and that the
    lower tiers were "cleared to disclose". No instrument in this repository
    establishes that.
    """
    if not mp_id:
        return None
    parts = mp_id.split("-")
    if len(parts) == 3:
        return f"MP-{parts[1]}-***"
    return "MP-***-***"


def _build_cards(rows, *, reveal_mp_identity: bool) -> list[AnomalyCard]:
    """Turn (work, risk) rows into response cards.

    ``reveal_mp_identity`` is False for the public list and True only for the
    AUDITOR/ADMIN-gated endpoint. It is a private helper rather than a query
    parameter on the public route, so it cannot be switched on by a caller.
    """
    cards = []
    for work, risk in rows:
        tier_val = risk.confidence_tier or "L1"
        evidence = risk.evidence_chain or {}
        active_signals = [
            k for k, v in evidence.items()
            if isinstance(v, dict) and v.get("score", 0) >= 0.3
        ]

        cards.append(
            AnomalyCard(
                work_id=work.work_id,
                official_work_ref=work.official_work_ref,
                district_name=work.district_name or work.district_code,
                district_code=work.district_code,
                state_code=work.state_code,
                constituency_name=work.constituency_name,
                work_type=work.work_type,
                work_description=work.work_description,
                sanction_amount=float(work.sanction_amount) if work.sanction_amount else None,
                composite_score=risk.composite_score,
                confidence_tier=tier_val,
                active_signals=active_signals,
                mp_id_masked=(
                    work.mp_id
                    if reveal_mp_identity
                    else _mask_mp_id(work.mp_id, tier_val)
                ),
                sanction_date=work.sanction_date,
                recommended_date=work.recommended_date,
                completion_date=work.completion_date,
            )
        )
    return cards


@router.get("/", response_model=list[AnomalyCard])
async def list_anomalies(
    tier: Optional[str] = None,
    state_code: Optional[str] = None,
    district_code: Optional[str] = None,
    reviewed: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """List all flagged anomalies (L1+), readable anonymously.

    The MP identity is masked at every tier, including L3. To see it, an
    AUDITOR/ADMIN account uses ``/l3/``.
    """
    q = (
        select(Work, RiskScore)
        .join(RiskScore, Work.work_id == RiskScore.work_id)
        .where(RiskScore.confidence_tier.in_(["L1", "L2", "L3"]))
    )

    filters = []
    if tier:
        filters.append(RiskScore.confidence_tier == tier)
    if state_code:
        filters.append(func.upper(Work.state_code) == state_code.strip().upper())
    if district_code:
        filters.append(Work.district_code == district_code)
    if reviewed is not None:
        filters.append(RiskScore.auditor_reviewed == reviewed)
    if filters:
        q = q.where(and_(*filters))

    q = q.order_by(desc(RiskScore.composite_score)).offset(skip).limit(limit)
    result = await db.execute(q)
    return _build_cards(result.all(), reveal_mp_identity=False)


@router.get("/l3/", response_model=list[AnomalyCard])
async def list_l3_anomalies(
    state_code: Optional[str] = None,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
):
    """High-confidence anomalies with the unmasked MP identity.

    Restricted to AUDITOR/ADMIN. This is the only place the identity is
    disclosed, because the public list masks every tier.

    It queried by delegating to `list_anomalies`, which meant it inherited that
    function's masking and so returned the identity masked here too Ã¢â‚¬â€ the
    audit-only view was not actually the unmasked one. The query is written out
    directly instead.
    """
    q = (
        select(Work, RiskScore)
        .join(RiskScore, Work.work_id == RiskScore.work_id)
        .where(RiskScore.confidence_tier == "L3")
    )
    if state_code:
        q = q.where(func.upper(Work.state_code) == state_code.strip().upper())

    q = q.order_by(desc(RiskScore.composite_score))
    result = await db.execute(q)
    return _build_cards(result.all(), reveal_mp_identity=True)


@router.get("/summary/")
async def anomaly_summary(
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard summary counts by tier."""
    result = await db.execute(
        select(RiskScore.confidence_tier, func.count(RiskScore.score_id))
        .where(RiskScore.confidence_tier.isnot(None))
        .group_by(RiskScore.confidence_tier)
    )
    rows = result.all()
    summary = {t: 0 for t in ["L1", "L2", "L3"]}
    for tier, count in rows:
        summary[tier] = count
    return summary


@router.post("/{work_id}/review")
async def review_anomaly(
    work_id: str,
    review: AuditorReviewRequest,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Record an auditor's verdict on a flagged work.

    The verdict vocabulary is the canonical one in `schemas.AuditorVerdict`
    (VERIFIED / DISMISSED / REFERRED / PENDING_INVESTIGATION); the legacy
    CONFIRMED and CLEARED values are normalised on input.

    Writes both the risk score and an immutable audit-log row attributed to the
    authenticated account. The previous implementation wrote
    `actor="SYSTEM"`, which made the review trail unattributable.
    """
    result = await db.execute(select(RiskScore).where(RiskScore.work_id == work_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(404, f"No risk score found for work {work_id}")

    old_value = {
        "verdict": risk.auditor_verdict,
        "reviewed": bool(risk.auditor_reviewed),
        "auditor_id": risk.auditor_id,
    }

    risk.auditor_reviewed = True
    risk.auditor_verdict = review.verdict.value
    risk.auditor_notes = review.notes
    risk.auditor_id = principal.username
    risk.reviewed_at = datetime.utcnow()
    risk.reviewed_by_role = principal.role.value

    db.add(
        AuditLog(
            action="AUDITOR_REVIEW",
            actor=principal.actor,
            entity_type="risk_score",
            entity_id=work_id,
            old_value=old_value,
            new_value={
                "verdict": review.verdict.value,
                "notes": review.notes,
                "reviewer_role": principal.role.value,
            },
        )
    )
    await db.commit()

    return {
        "status": "ok",
        "work_id": work_id,
        "verdict": review.verdict.value,
        "reviewed_by": principal.username,
        "reviewed_at": risk.reviewed_at.isoformat(),
    }


@router.get("/lapse-risk/")
async def lapse_risk_anomalies(
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """Districts flagged for fund lapse risk.

    Reads the `lapse_forecasts` table, which the current data pipeline does not
    populate: the open MPLADS feed publishes no district-wise released/spent
    time series to fit a lapse model on. This route therefore returns an empty
    list in this deployment, which is correct Ã¢â‚¬â€ it must not synthesise lapse
    figures to fill the panel.
    """
    result = await db.execute(
        select(LapseForecast)
        .where(LapseForecast.lapse_tier.in_(["HIGH", "CRITICAL"]))
        .order_by(desc(LapseForecast.lapse_probability))
        .limit(20)
    )
    forecasts = result.scalars().all()
    return [
        {
            "district_code": f.district_code,
            "mp_id": f.mp_id,
            "fiscal_year": f.fiscal_year,
            "projected_lapse": float(f.projected_lapse or 0),
            "lapse_probability": f.lapse_probability,
            "lapse_tier": f.lapse_tier,
            "allocated_amount": float(f.allocated_amount or 0),
            "spent_to_date": float(f.spent_to_date or 0),
        }
        for f in forecasts
    ]
