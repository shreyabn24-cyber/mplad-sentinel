"""MPLADS Sentinel — Contractors Router

The contractor-network analysis cannot be produced from the open MPLADS feed:
the published work records carry no vendor name and no GSTIN. Three things
follow, and this module implements all three honestly:

* No network graph, no bid-ringing communities, no "common director" edges are
  invented. With no trained artefact the graph is empty.
* Empty is not the same as clean, so every response carries ``available`` and a
  ``reason``. A UI can therefore say "not analysed" rather than implying the
  absence of a cartel.
* Vendor lookups and the artefact load are restricted to AUDITOR/ADMIN, since
  they concern named commercial parties. In this deployment there are no
  contractor rows to return, but the route must still not be open.

Artefact loading also refuses ``pickle``. ``pickle.load`` executes whatever the
file contains, so an artefact is only ever loaded after a review, and the refusal
is explicit rather than a silent ``ImportError``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import ROLES_AUDIT, Principal, require_roles, viewer
from database import get_db
from models.models import Contractor, Work
from schemas.schemas import (
    ContractorCapabilityStatus,
    ContractorGraphData,
    ContractorResponse,
)

router = APIRouter()

GRAPH_MODEL_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "ml" / "saved_models" / "contractor_graph.pkl"
)

# Stated once and reused, so the reason a capability is missing is worded
# identically everywhere it surfaces.
NO_VENDOR_DATA = (
    "The open MPLADS feed publishes no vendor name and no GSTIN for any work, so "
    "there is no data on which a contractor network, bid-ringing cluster or GSTIN "
    "compliance check could be computed. This analysis is not performed, not "
    "'performed and clean'."
)


@router.get("/status", response_model=ContractorCapabilityStatus)
async def get_contractor_capability(
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """State plainly whether the vendor-network analysis can run at all."""
    record_count = (await db.execute(func.count(Contractor.gstin))).scalar() or 0
    has_model = GRAPH_MODEL_PATH.exists()
    return ContractorCapabilityStatus(
        graph_available=has_model and record_count > 0,
        clusters_available=has_model and record_count > 0,
        reason=None if has_model and record_count > 0 else NO_VENDOR_DATA,
        data_source="none",
        records=int(record_count),
    )


@router.get(
    "/",
    response_model=list[ContractorResponse],
    dependencies=[Depends(require_roles(ROLES_AUDIT))],
)
async def list_contractors(
    state_code: Optional[str] = None,
    status: Optional[str] = None,
    min_risk: Optional[float] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """List contractors.

    Restricted to AUDITOR/ADMIN: this returns named commercial parties with
    compliance and risk attributes. It is currently empty because the feed
    carries no vendor data.
    """
    q = select(Contractor)
    if state_code:
        q = q.where(Contractor.state_code == state_code.strip().upper())
    if status:
        q = q.where(Contractor.gstin_status == status)
    if min_risk:
        q = q.where(Contractor.risk_score >= min_risk)
    q = q.order_by(desc(Contractor.risk_score)).offset(skip).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


def _load_graph_artefact() -> dict[str, Any]:
    """Load the trained graph artefact, refusing to unpickle it.

    The historical implementation called ``pickle.load`` on this path.
    ``pickle.load`` is arbitrary code execution: anything that can write to
    ``ml/saved_models/`` can therefore run code as the API process. There is no
    untrusted-input path to this file, but the cost of keeping the call is high
    and the cost of removing it is one JSON export, so unpickling is refused.
    """
    import json

    sidecar = GRAPH_MODEL_PATH.with_suffix(".json")
    if not sidecar.exists():
        raise HTTPException(
            status_code=501,
            detail=(
                "No contractor graph is available. The artefact is a pickle, which "
                "this service deliberately will not load because unpickling executes "
                f"arbitrary code; export it to {sidecar.name} instead."
            ),
        )
    with open(sidecar, encoding="utf-8") as handle:
        return json.load(handle)


@router.get("/graph", response_model=ContractorGraphData)
async def get_contractor_graph(
    mp_id: Optional[str] = None,
    principal: Principal = Depends(viewer),
    db: AsyncSession = Depends(get_db),
):
    """Return the contractor-MP network graph for D3 visualisation.

    With no analysable data this returns an empty graph **and** the reason, so
    the UI can distinguish "not analysed" from "analysed, nothing found". The
    previous implementation invented a realistic network of named MPs and
    contractors with risk scores and contract values, which the UI then rendered
    as a detected bid-ringing cartel. An oversight tool must never assert a
    criminal relationship that no data supports.
    """
    if not GRAPH_MODEL_PATH.exists():
        return ContractorGraphData(nodes=[], links=[], available=False, reason=NO_VENDOR_DATA)

    data = _load_graph_artefact()
    graph = data.get("nodes_by_id") or {}
    edges = data.get("links") or []
    contractor_scores = data.get("contractor_scores", {})
    mp_scores = data.get("mp_scores", {})

    nodes: list[dict[str, Any]] = []
    for node_id, attrs in graph.items():
        nodes.append(
            {
                "id": node_id,
                "type": attrs.get("type", "UNKNOWN"),
                "name": attrs.get("name"),
                "total_works": attrs.get("total_works", 0),
                "total_value": attrs.get("total_value", 0),
                "risk_score": contractor_scores.get(node_id, mp_scores.get(node_id, 0)),
                "community": attrs.get("community"),
            }
        )

    links: list[dict[str, Any]] = []
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if mp_id and source != mp_id and target != mp_id:
            continue
        links.append(edge)

    return ContractorGraphData(nodes=nodes, links=links, available=True)


@router.get("/clusters")
async def get_suspicious_clusters(
    principal: Principal = Depends(viewer),
):
    """Return top suspicious contractor clusters, or an empty list with a reason.

    Always returns the array shape the frontend expects, so an empty list is
    ambiguous on its own; pair it with ``GET /contractors/status``.
    """
    if not GRAPH_MODEL_PATH.exists():
        return []

    data = _load_graph_artefact()
    communities = data.get("communities", {})
    contractor_scores = data.get("contractor_scores", {})

    suspicious = []
    for cid, members in communities.items():
        contractors = [n for n in members if n in contractor_scores]
        if not contractors:
            continue
        avg_score = sum(contractor_scores[c] for c in contractors) / len(contractors)
        if avg_score > 0.4:
            suspicious.append(
                {
                    "community_id": cid,
                    "contractors": contractors[:5],
                    "total_nodes": len(members),
                    "avg_risk_score": round(avg_score, 3),
                }
            )
    return sorted(suspicious, key=lambda x: x["avg_risk_score"], reverse=True)[:10]


@router.get(
    "/{gstin}/risk",
    dependencies=[Depends(require_roles(ROLES_AUDIT))],
)
async def get_contractor_risk(gstin: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Contractor).where(Contractor.gstin == gstin))
    contractor = result.scalar_one_or_none()
    if not contractor:
        raise HTTPException(
            404,
            f"No contractor record for {gstin}. The open MPLADS feed publishes no "
            "GSTIN, so no vendor records exist in this deployment.",
        )
    works_result = await db.execute(
        select(Work).where(Work.contractor_gstin == gstin).limit(20)
    )
    works = works_result.scalars().all()
    return {
        "contractor": ContractorResponse.model_validate(contractor),
        "total_works_in_db": len(works),
        "recent_works": [w.work_id for w in works[:10]],
    }
