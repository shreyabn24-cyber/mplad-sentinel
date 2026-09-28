"""MPLADS Sentinel — Admin Router

Design rule for this module: an endpoint must never report success for work it
did not do, and no endpoint may be reachable by an anonymous caller.

Where a capability is not implemented in this deployment, the endpoint says so
explicitly via ``status="not_implemented"`` and an HTTP 501, so the operator UI
can surface the truth instead of a green light.

Every route requires an ADMIN token. The pipeline controls here start jobs,
spend external API quota and write model artefacts, so they are the highest-
consequence operations in the system — they were previously open to anyone who
could reach the port.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import ROLES_ADMIN, ROLES_AUDIT, Principal, require_roles
from database import get_db
from models.models import RiskScore, Work

router = APIRouter()

require_admin = require_roles(ROLES_ADMIN)
# Pipeline telemetry is read-only but sensitive, so it is not anonymous.
require_audit = require_roles(ROLES_AUDIT)

# Trained on verified real data by ml/training/train_real.py.
ML_ARTIFACTS = [
    "ml/saved_models/isolation_forest.pkl",
    "ml/saved_models/isolation_forest_manifest.json",
    "data/output/works_scored.csv",
]

# Models deliberately NOT produced, because the open MPLADS feed cannot support
# them. Listed so the status endpoint reports the reason instead of looking
# broken or silently omitting the capability.
ML_WITHHELD = {
    "contractor_graph": "no vendor identifier or GSTIN in the open feed",
    "prophet_lapse": "no district-wise released/spent time series available",
    "gstin_compliance": "no GSTIN data available",
}


@router.get("/pipeline-status")
async def pipeline_status(
    principal: Principal = Depends(require_audit),
    db: AsyncSession = Depends(get_db),
):
    """Return current pipeline health and counts.

    Statuses are *derived*, never hardcoded:
      works/scored/l*_count come from the database.
      scraper/ml/satellite report whether their optional dependency is importable
      and whether their artefact is present on disk.
    """
    works_count = (await db.execute(func.count(Work.work_id))).scalar() or 0
    scored_count = (await db.execute(func.count(RiskScore.score_id))).scalar() or 0
    tiers_result = await db.execute(
        select(RiskScore.confidence_tier, func.count(RiskScore.score_id))
        .where(RiskScore.confidence_tier.isnot(None))
        .group_by(RiskScore.confidence_tier)
    )
    tiers = {t: c for t, c in tiers_result.all()}

    unclassified = (await db.execute(
        select(func.count(Work.work_id))
        .outerjoin(RiskScore, Work.work_id == RiskScore.work_id)
        .where(RiskScore.score_id.is_(None))
    )).scalar() or 0

    # A pipeline with work in the DB but no scores is degraded, not operational.
    if works_count == 0:
        overall = "EMPTY"
    elif scored_count == 0:
        overall = "DEGRADED"
    elif unclassified > 0:
        overall = "PARTIAL"
    else:
        overall = "OPERATIONAL"

    return {
        "status": overall,
        "works_in_db": works_count,
        "works_scored": scored_count,
        "works_unscored": unclassified,
        "l1_count": tiers.get("L1", 0),
        "l2_count": tiers.get("L2", 0),
        "l3_count": tiers.get("L3", 0),
        "last_checked": datetime.now(timezone.utc).isoformat(),
        "scraper_status": _component_status("data.sync_live_mospi"),
        # ml.models.isolation_forest is the module that actually exists; the
        # previous path (ml.ensemble.isolation_forest) was never written.
        "ml_status": _component_status("ml.models.isolation_forest", artifacts=ML_ARTIFACTS),
        "satellite_status": _component_status("ml.models.satellite_detector"),
        "ml_withheld": ML_WITHHELD,
        "notes": (
            "Anomaly scores come from the offline ml/training/train_real.py run "
            "over verified work records. Contractor-network, GSTIN-compliance "
            "and lapse-forecast outputs are withheld because the open MPLADS "
            "feed has no vendor or district expenditure data to train them on; "
            "see ml_withheld for the reason per capability."
        ),
    }


def _component_status(module_path: str, artifacts: list[str] | None = None) -> str:
    """Report whether an optional component is importable and artefact-backed.

    The dotted path is resolved in full. The previous version only looked at the
    top-level package (`ml.ensemble.isolation_forest` -> `ml`), so it reported
    "AVAILABLE" for any module path as long as a directory of that name existed
    anywhere on the path — including for components that were never written.
    """
    import importlib.util
    from pathlib import Path

    repo_root = Path(__file__).resolve().parent.parent.parent
    try:
        if importlib.util.find_spec(module_path) is None:
            return "NOT_INSTALLED"
    except (ImportError, ValueError, ModuleNotFoundError):
        return "NOT_INSTALLED"

    if artifacts:
        present = any((repo_root / a).exists() for a in artifacts)
        if not present:
            return "NO_ARTEFACTS"
    return "AVAILABLE"


@router.post("/trigger-pipeline")
async def trigger_pipeline(principal: Principal = Depends(require_admin)):
    """Manually trigger a full scoring run.

    Requires a Celery worker and the ``tasks.ml_tasks`` module. Neither ships in
    this repository, so this reports 501 rather than pretending to have run.
    """
    try:
        from tasks.ml_tasks import run_full_scoring  # type: ignore[import-not-found]
    except ImportError as exc:
        raise HTTPException(
            status_code=501,
            detail=(
                "No scoring worker is configured. `tasks.ml_tasks` does not exist "
                "in this repository, so a full pipeline run cannot be dispatched. "
                "Run the offline scorer in ml/training instead."
            ),
        ) from exc

    task = run_full_scoring.delay()
    return {"status": "triggered", "task_id": task.id, "triggered_by": principal.actor}


@router.post("/sync-mospi")
async def sync_mospi(principal: Principal = Depends(require_admin)):
    """Return the last persisted MoSPI national figures.

    This reads a snapshot on disk. It does not perform a live network sync — the
    snapshot's own ``last_synced_at`` timestamp is passed through so the caller
    can judge freshness instead of being told "synced".
    """
    stats_file = Path(__file__).resolve().parent.parent.parent / "data" / "output" / "live_national_stats.json"
    if not stats_file.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"No MoSPI snapshot at {stats_file}. Run data/sync_live_mospi.py "
                "to create one; this endpoint does not fetch from the network."
            ),
        )

    import json

    with open(stats_file, encoding="utf-8") as f:
        stats = json.load(f)

    return {
        "status": "snapshot",
        "message": (
            "Returning the stored MoSPI snapshot — this is NOT a live sync. "
            "Freshness is governed by the snapshot's last_synced_at field."
        ),
        "national_stats": stats,
    }


@router.post("/run-cross-scheme")
async def run_cross_scheme(principal: Principal = Depends(require_admin)):
    """Return cross-scheme duplicate-funding candidates from a stored result set.

    Reports 404 when no detector output exists rather than claiming the
    detector "is running".
    """
    import csv

    matches_file = Path(__file__).resolve().parent.parent.parent / "data" / "output" / "cross_scheme_matches.csv"
    if not matches_file.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"No cross-scheme detector output at {matches_file}. The detector "
                "has not been run against MGNREGA/PMGSY data in this deployment."
            ),
        )

    with open(matches_file, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    return {
        "status": "ok",
        "matches_found": len(rows),
        "message": f"Read {len(rows)} candidate duplicate-funding pairs from the stored detector output.",
    }


@router.post("/train-ml")
async def train_ml_pipeline(principal: Principal = Depends(require_admin)):
    """Report on the state of the ML artefacts.

    Training is performed offline by ``ml/training/train_real.py`` and is NOT
    wired to an HTTP trigger in this deployment. This endpoint therefore reports
    what is actually on disk (501 when nothing is) instead of returning a
    fabricated completion message.
    """
    import json
    from pathlib import Path

    repo_root = Path(__file__).resolve().parent.parent.parent
    present = [a for a in ML_ARTIFACTS if (repo_root / a).exists()]

    if not present:
        raise HTTPException(
            status_code=501,
            detail=(
                "No trained model artefacts found. Training is an offline job "
                "(ml/training/train_real.py) and is not exposed as an HTTP action. "
                f"Expected one of: {ML_ARTIFACTS}"
            ),
        )

    trained_on: dict = {}
    manifest_path = repo_root / "ml" / "saved_models" / "isolation_forest_manifest.json"
    if manifest_path.exists():
        try:
            trained_on = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            trained_on = {"error": "manifest present but unreadable"}

    return {
        "status": "artefacts_present",
        "message": "Model artefacts found on disk. They were produced by the offline training job, not by this request.",
        "models": present,
        "trained_on": trained_on,
        "withheld": ML_WITHHELD,
    }
