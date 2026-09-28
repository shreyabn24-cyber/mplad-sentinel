"""
MPLADS Sentinel — Satellite Scene Router

Locates real Sentinel-2 L2A scenes through the Free AWS Open Data STAC API
(https://earth-search.aws.element84.com/v1/search).

IMPORTANT: this router performs a *scene search only*. A STAC search returns
scene metadata, not pixels, so no NDBI/NDVI delta and no construction verdict is
produced (see ml/models/satellite_detector.py HONESTY NOTE). Responses here
report where the imagery is, not what it shows.

Three corrections made in this pass:

1. ``GET /{work_id}`` reported the single stored ``sentinel_tile_id`` as both
   ``scene_id_before`` and ``scene_id_after``. That presents one scene as though
   it were a before/after pair, which is exactly the impression a change
   assessment requires. The before/after fields are now null with a stated
   reason; only the one real tile is reported.
2. ``POST /trigger-check`` computed a search and threw the result away, so
   ``GET /{work_id}`` could never find a recorded check and the two endpoints
   contradicted each other. The check is now persisted.
3. ``POST /query-aws`` was open to anonymous callers and accepts arbitrary
   coordinates, so it was an unmetered proxy for someone else's API quota. It
   now requires an AUDITOR/ADMIN token and validates its inputs.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from auth import ROLES_AUDIT, Principal, require_roles, viewer, write_audit_log
from database import get_db
from models.models import SatelliteCheck, Work

router = APIRouter()

# The detector is imported lazily. Importing it (and constructing it) at module
# scope made the whole FastAPI app fail to boot whenever the optional ML stack
# was absent, taking every unrelated route down with it.
_detector = None

STALE_PAIR_REASON = (
    "A scene search records one tile, not a before/after pair. No second "
    "reference date was captured, so no imagery comparison exists and no change "
    "can be read from this record."
)


def get_detector():
    global _detector
    if _detector is None:
        try:
            from ml.models.satellite_detector import SatelliteChangeDetector
        except Exception as exc:  # ImportError, or a broken optional dep chain
            raise HTTPException(
                503,
                f"Satellite module unavailable: {type(exc).__name__}: {exc}",
            )
        _detector = SatelliteChangeDetector()
    return _detector


def _serialize(sat_res) -> dict:
    """Serialize a SatelliteResult, preserving 'not measured' as null."""
    return {
        "work_id": sat_res.work_id,
        "status": sat_res.status,
        "applicable": sat_res.applicable,
        "date_before": sat_res.date_before or None,
        "date_after": sat_res.date_after or None,
        "ndbi_before": sat_res.ndbi_before,
        "ndbi_after": sat_res.ndbi_after,
        "ndbi_change": sat_res.ndbi_change,
        "ndvi_before": sat_res.ndvi_before,
        "ndvi_after": sat_res.ndvi_after,
        "ndvi_change": sat_res.ndvi_change,
        "change_score": sat_res.change_score,
        "satellite_flag": sat_res.satellite_flag,
        "confidence": sat_res.confidence,
        "cloud_coverage_pct": sat_res.cloud_coverage_pct,
        "thumbnail_before_url": sat_res.thumbnail_before_url,
        "thumbnail_after_url": sat_res.thumbnail_after_url,
        "scene_id_before": sat_res.scene_id_before,
        "scene_id_after": sat_res.scene_id_after,
        "data_source": sat_res.data_source,
        "evidence_text": sat_res.evidence_text,
    }


class AWSQueryRequest(BaseModel):
    # Bounded and validated: previously any string reached the STAC query, so a
    # caller could pass a 10,000-character "date" and have it forwarded upstream.
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    max_cloud_cover: Optional[float] = Field(default=25.0, ge=0, le=100)

    def validated_range(self) -> tuple[date, date]:
        try:
            start = date.fromisoformat(self.start_date)
            end = date.fromisoformat(self.end_date)
        except ValueError as exc:
            raise HTTPException(422, f"start_date/end_date must be ISO dates: {exc}") from exc
        if end <= start:
            raise HTTPException(422, "end_date must be after start_date.")
        if (end - start).days > 366:
            raise HTTPException(422, "Date range must not exceed 366 days.")
        return start, end


@router.get("/{work_id}")
async def get_satellite_result(
    work_id: str,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """Scene metadata for a work, if a recorded check exists in the database.

    This endpoint reports only checks that were persisted by an operator. It
    does not synthesise a result on the fly, and it does not substitute default
    coordinates for a work that has none — a STAC search at a substituted
    location returns imagery that does not depict the work.
    """
    result = await db.execute(
        select(SatelliteCheck)
        .where(SatelliteCheck.work_id == work_id)
        .order_by(desc(SatelliteCheck.check_date))
        .limit(1)
    )
    check = result.scalar_one_or_none()
    if not check:
        raise HTTPException(
            404,
            f"No recorded satellite check for work {work_id}. "
            "Run POST /satellite/trigger-check with the work's own coordinates to create one.",
        )

    notes = check.notes or STALE_PAIR_REASON
    return {
        "work_id": check.work_id,
        "status": "RECORDED",
        "check_date": check.check_date.isoformat() if check.check_date else None,
        "date_before": check.date_before.isoformat() if check.date_before else None,
        "date_after": check.date_after.isoformat() if check.date_after else None,
        "ndbi_change": check.ndbi_change,
        "ndvi_change": check.ndvi_change,
        "change_score": check.change_score,
        "satellite_flag": check.satellite_flag,
        "confidence": check.confidence,
        "cloud_coverage_pct": check.cloud_coverage_pct,
        "applicable": True,
        "thumbnail_before_url": check.thumbnail_before_url,
        "thumbnail_after_url": check.thumbnail_after_url,
        # One tile is one tile. Reporting it in both slots implied a comparison
        # that was never made.
        "scene_id_before": None,
        "scene_id_after": None,
        "scene_id_recorded": check.sentinel_tile_id,
        "data_source": "AWS Open Data (Sentinel-2 L2A) — scene metadata only",
        "evidence_text": notes,
    }


class TriggerCheckRequest(BaseModel):
    work_id: Optional[str] = None


@router.post("/trigger-check")
async def trigger_satellite_check(
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
    req: Optional[TriggerCheckRequest] = None,
    work_id: Optional[str] = None,
):
    """Run an on-demand AWS Sentinel-2 scene search for a project and record it.

    Returns 400 when the work is unknown or has no coordinates. Default
    coordinates are deliberately NOT substituted: a STAC search at a
    substituted location returns imagery of a place that is not the work.

    The result is persisted so that ``GET /{work_id}`` can serve it. The
    previous version discarded it, which made the read endpoint permanently
    404 and the "recorded check" message misleading.
    """
    target_id = (req.work_id if req and req.work_id else None) or work_id
    if not target_id:
        raise HTTPException(400, "work_id must be provided in request body or query parameter")

    work_result = await db.execute(select(Work).where(Work.work_id == target_id))
    work = work_result.scalar_one_or_none()
    if not work:
        raise HTTPException(404, f"Work {target_id} not found; coordinates cannot be resolved")

    # `is None` rather than falsiness: 0.0 is a real latitude, and the old check
    # treated a work on the equator as having no location at all.
    if work.reported_lat is None or work.reported_lon is None:
        raise HTTPException(
            400,
            f"Work {target_id} has no reported coordinates, so no scene search can be "
            "run for it. Record its location first. Note that any stored coordinate "
            "is an administrative place centroid, not a surveyed work position.",
        )

    detector = get_detector()
    sat_res = detector.check_work_aws(
        work_id=target_id,
        lat=work.reported_lat,
        lon=work.reported_lon,
        work_type=(work.work_type or "cc_road").lower(),
        sanction_date=work.sanction_date,
        completion_date=work.completion_date,
    )

    payload = _serialize(sat_res)
    payload["work_id"] = target_id
    payload["message"] = {
        "OK": "Scene search complete. A scene was located; no index delta is computed (see evidence_text).",
        "INCONCLUSIVE": "Scene search ran but only one of two required scenes was located.",
        "UNAVAILABLE": "Scene search could not be completed for this work.",
        "NOT_APPLICABLE": "Satellite checking does not apply to this work type at 10m resolution.",
    }.get(sat_res.status, "Scene search finished.")

    if sat_res.status in ("UNAVAILABLE", "NOT_APPLICABLE"):
        # A failed search is not recorded as if it had produced a result.
        return JSONResponse(status_code=503, content=payload)

    record = SatelliteCheck(
        work_id=target_id,
        date_before=sat_res.date_before,
        date_after=sat_res.date_after,
        ndbi_change=sat_res.ndbi_change,
        ndvi_change=sat_res.ndvi_change,
        change_score=sat_res.change_score,
        satellite_flag=bool(sat_res.satellite_flag) if sat_res.satellite_flag is not None else None,
        confidence=sat_res.confidence,
        cloud_coverage_pct=sat_res.cloud_coverage_pct,
        # Only the STAC preview assets are available, so they go in the
        # thumbnail columns. The imagery_* columns are for full-resolution
        # assets, which this deployment does not fetch; leaving them null is
        # accurate, whereas copying a preview URL into them would overstate
        # what was retrieved.
        thumbnail_before_url=sat_res.thumbnail_before_url,
        thumbnail_after_url=sat_res.thumbnail_after_url,
        sentinel_tile_id=sat_res.scene_id_before or sat_res.scene_id_after,
        model_version="stac-metadata-only",
        notes=(sat_res.evidence_text or "") + " " + STALE_PAIR_REASON,
    )
    db.add(record)
    await write_audit_log(
        db,
        principal,
        action="satellite.scene_search",
        entity_type="work",
        entity_id=target_id,
        new_value={
            "status": sat_res.status,
            "scene_id": record.sentinel_tile_id,
            # Recorded so a reader knows what the search was actually centred on.
            "searched_lat": work.reported_lat,
            "searched_lon": work.reported_lon,
            "coordinate_precision": work.coordinate_precision,
        },
    )
    await db.commit()

    payload["recorded"] = True
    return payload


@router.post("/query-aws")
async def query_aws_satellite(
    payload: AWSQueryRequest,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
):
    """Query the AWS Open Data STAC API directly for a coordinate.

    Restricted to AUDITOR/ADMIN and coordinate-validated: this endpoint was
    open to anonymous callers and forwarded any string to the STAC service,
    which made it an unmetered proxy for a third party's API quota.
    """
    payload.validated_range()

    scene = get_detector().fetch_scene_from_aws(
        lat=payload.lat,
        lon=payload.lon,
        start_date=payload.start_date,
        end_date=payload.end_date,
        max_cloud_cover=payload.max_cloud_cover if payload.max_cloud_cover is not None else 25.0,
    )
    if not scene:
        return {
            "status": "not_found",
            "message": (
                "No Sentinel-2 scene matching those coordinates, dates and cloud "
                "limit was found in AWS Earth Search."
            ),
            "data_source": "AWS Earth Search STAC (sentinel-2-l2a)",
        }
    return {
        "status": "found",
        "scene": scene,
        "data_source": "AWS Earth Search STAC (sentinel-2-l2a)",
        "notice": "Scene metadata only. No pixel values are read and no change is assessed.",
    }
