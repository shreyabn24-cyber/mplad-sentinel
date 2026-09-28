"""MPLADS Sentinel — MP Router

Two things were wrong here before this rewrite, both of which produced confident
numbers that were not real:

1. ``GET /mp/national-stats`` fell back to a **hardcoded dictionary** of
   national figures when the live snapshot file was absent. Those constants
   were stale relative to the current MoSPI API (expenditure, recommended and
   completed counts had all moved). A missing file now returns an explicit
   "unavailable" payload instead of remembered numbers.
2. ``GET /mp/{mp_id}/profile`` ran one query per work to fetch its risk tier.
   An MP with 500 works meant 501 round trips. The tiers now come from a single
   grouped query, and the spent/sanctioned totals report ``null`` rather than
   ``0.0`` when no work carries expenditure data — summing NULLs to zero and
   printing "₹ 0 spent" reads as "nothing was spent", which is a different and
   much stronger claim than "we do not have this figure".
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import Principal, viewer
from database import get_db
from models.models import LapseForecast, MP, RiskScore, Work

router = APIRouter()

STATS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "output" / "live_national_stats.json"


@router.get("/national-stats")
async def get_national_stats(principal: Principal = Depends(viewer)):
    """Return the stored MoSPI national snapshot.

    The snapshot is written by ``data/sync_live_mospi.py`` and carries its own
    ``last_synced_at``. This route never fabricates a fallback: if the snapshot
    is missing the caller is told the figures are unavailable, because the
    previous hardcoded fallback showed stale constants to anyone who started the
    app without first running the sync.
    """
    if not STATS_FILE.exists():
        return {
            "available": False,
            "source": "MoSPI (via data/sync_live_mospi.py)",
            "last_synced_at": None,
            "notice": (
                "No MoSPI snapshot is present on this deployment, so national "
                "aggregates are unavailable. Run `python data/sync_live_mospi.py` "
                "to fetch them. No figures are estimated or remembered here."
            ),
        }

    with open(STATS_FILE, encoding="utf-8") as handle:
        stats = json.load(handle)

    return {
        "available": True,
        "source": stats.get("source", "MoSPI (via data/sync_live_mospi.py)"),
        "last_synced_at": stats.get("last_synced_at"),
        "figures": stats,
        "notice": (
            "Figures are the stored MoSPI snapshot, not a live query. Check "
            "last_synced_at for freshness."
        ),
    }


@router.get("/")
async def list_mps(
    state_code: Optional[str] = None,
    has_party: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """List MPs.

    ``party`` is not a stored filter value: the MoSPI feed does not publish
    party affiliation, so every row is NULL. The previous ``party`` parameter
    matched against NULL and silently returned an empty list, which read as
    "no MPs from that party" rather than "party is unknown". ``has_party``
    replaces it honestly.
    """
    q = select(MP)
    if state_code:
        q = q.where(MP.state_code == state_code.strip().upper())
    if has_party is True:
        q = q.where(MP.party.isnot(None))
    elif has_party is False:
        q = q.where(MP.party.is_(None))

    result = await db.execute(q.order_by(MP.full_name).offset(skip).limit(limit))
    return [
        {
            "mp_id": m.mp_id,
            "full_name": m.full_name,
            # Explicitly None, not "Unknown": the feed has no party column.
            "party": m.party,
            "party_known": m.party is not None,
            "state_code": m.state_code,
            "constituency_code": m.constituency_code,
        }
        for m in result.scalars().all()
    ]


@router.get("/{mp_id}/profile")
async def get_mp_profile(
    mp_id: str,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(MP).where(MP.mp_id == mp_id))
    mp = result.scalar_one_or_none()
    if not mp:
        raise HTTPException(404, f"MP {mp_id} not found")

    # One grouped query for the work aggregates, replacing a per-work loop that
    # issued an extra round trip for every work the MP had.
    aggregate = await db.execute(
        select(
            func.count(Work.work_id),
            func.sum(Work.sanction_amount),
            func.sum(Work.expenditure_amount),
            func.count(Work.expenditure_amount),
            func.count(Work.sanction_amount),
        ).where(Work.mp_id == mp_id)
    )
    total_works, sum_sanctioned, sum_spent, with_expenditure, with_sanction = aggregate.one()

    tier_rows = await db.execute(
        select(RiskScore.confidence_tier, func.count(RiskScore.score_id))
        .join(Work, Work.work_id == RiskScore.work_id)
        .where(Work.mp_id == mp_id, RiskScore.confidence_tier.isnot(None))
        .group_by(RiskScore.confidence_tier)
    )
    tiers = {tier: count for tier, count in tier_rows.all()}

    type_rows = await db.execute(
        select(Work.work_type, func.count(Work.work_id))
        .where(Work.mp_id == mp_id)
        .group_by(Work.work_type)
    )
    year_rows = await db.execute(
        select(Work.scheme_year, func.count(Work.work_id))
        .where(Work.mp_id == mp_id)
        .group_by(Work.scheme_year)
    )

    # Never synthesise an allocation. `MP.annual_allocation` is nullable and has
    # no default, so when it is NULL there is genuinely nothing to divide by and
    # both fields are reported as null for the UI to render as unavailable.
    allocation = float(mp.annual_allocation) if mp.annual_allocation is not None else None
    utilization = (float(sum_spent) / allocation * 100) if allocation and sum_spent else None

    # `None` (unknown) rather than 0.0 when no work carries the field: the open
    # feed publishes no per-work expenditure, so "₹ 0 spent" would be a false
    # claim that the MP spent nothing.
    total_spent = float(sum_spent) if sum_spent is not None else None
    total_sanctioned = float(sum_sanctioned) if sum_sanctioned is not None else None

    return {
        "mp_id": mp.mp_id,
        "full_name": mp.full_name,
        "party": mp.party,
        "party_known": mp.party is not None,
        "state_code": mp.state_code,
        "constituency_code": mp.constituency_code,
        "term_start": mp.term_start,
        "term_end": mp.term_end,
        "total_works": int(total_works or 0),
        "total_sanctioned": total_sanctioned,
        "total_spent": total_spent,
        "works_with_expenditure_data": int(with_expenditure or 0),
        "works_with_sanction_amount": int(with_sanction or 0),
        "expenditure_data_available": bool(with_expenditure),
        "allocation_available": allocation is not None,
        "total_allocation": allocation,
        "utilization_pct": utilization,
        "allocation_note": (
            None
            if allocation is not None
            else "No authoritative MPLADS allocation figure is stored for this MP, so "
            "allocation and utilisation cannot be computed and are not shown."
        ),
        "expenditure_note": (
            None
            if with_expenditure
            else "The open MPLADS feed publishes no per-work expenditure, so this MP's "
            "spending total is unknown rather than zero and is not shown as a figure."
        ),
        "l1_flags": tiers.get("L1", 0),
        "l2_flags": tiers.get("L2", 0),
        "l3_flags": tiers.get("L3", 0),
        "works_by_type": {t: c for t, c in type_rows.all() if t},
        "works_by_year": {str(y): c for y, c in year_rows.all()},
    }


@router.get("/{mp_id}/lapse-forecast")
async def get_mp_lapse_forecast(
    mp_id: str,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """Stored lapse forecasts for an MP.

    The current pipeline does not produce lapse forecasts: the open feed has no
    district-wise released/spent time series to fit one on. An empty result is
    returned with that stated, rather than a modelled number.
    """
    result = await db.execute(
        select(LapseForecast)
        .where(LapseForecast.mp_id == mp_id)
        .order_by(desc(LapseForecast.forecast_date))
        .limit(5)
    )
    forecasts = result.scalars().all()
    if not forecasts:
        return {
            "mp_id": mp_id,
            "status": "unavailable",
            "forecasts": [],
            "reason": (
                "No lapse forecast is available. Forecasts require a district-wise "
                "released/spent time series, which the open MPLADS feed does not publish."
            ),
        }
    return {
        "mp_id": mp_id,
        "status": "ok",
        "forecasts": [
            {
                "district_code": f.district_code,
                "fiscal_year": f.fiscal_year,
                "projected_lapse": float(f.projected_lapse or 0),
                "lapse_probability": f.lapse_probability,
                "lapse_tier": f.lapse_tier,
                "allocated_amount": float(f.allocated_amount or 0),
                "spent_to_date": float(f.spent_to_date or 0),
            }
            for f in forecasts
        ],
    }
