"""
MPLADS Sentinel — Citizen Router: ground-truth reports, evidence uploads, and
the public demand register.

What changed and why
--------------------
1. **Auth.** ``POST /report`` and ``GET /reports`` were open to any anonymous
   caller. Reports are submitted evidence attributed to a named citizen, and
   the read endpoints expose other people's account names, coordinates, and
   comments, so all of them require a token. The reporting paths need CITIZEN;
   the listing and download paths are restricted to AUDITOR/ADMIN, because a
   citizen's statement about a work is not automatically public information.

2. **Uploads actually work.** ``CitizenReport.photo_url`` existed in the schema
   and the API had no upload route at all, so it was always NULL while the
   portal presented a photo-capture flow. ``POST /report/with-evidence`` now
   accepts real files, validates them, and records them.

3. **The demand register is real.** The previous demand flow lived entirely in
   ``localStorage`` and simulated the government chain: the MP portal
   "endorsed" requests and the district portal issued a sanction showing a
   fabricated ``SO-KAN-<digits>`` order number and a random ``PFMS...`` UTR. No
   office was contacted. ``/demands`` stores the request, its evidence, and the
   routing state, and issues only this portal's own receipt reference.

4. **A real bug:** ``GET /reports`` ordered by ``CitizenReport.created_at``, a
   column the model does not have (it is ``submitted_at``). The endpoint raised
   ``AttributeError`` on every call, so the citizen verification panel could
   never have loaded.

5. **Evidence is retrievable.** The reports table had a download control in the
   UI that produced no file, because no route served the bytes.
   ``GET /evidence/{id}/download`` now streams the stored file to an auditor,
   logs the access, and refuses a stored path that resolves outside the
   evidence root.
"""

from __future__ import annotations

import math
import re
import secrets
import string
from datetime import datetime
from typing import Literal, Optional
from urllib.parse import quote
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, desc, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    ROLES_AUDIT,
    ROLES_CITIZEN,
    ROLES_OFFICE,
    Principal,
    Role,
    require_roles,
    viewer,
    write_audit_log,
)
from config import settings
from database import get_db
from models.models import (
    CitizenDemand,
    CitizenReport,
    EvidenceAttachment,
    Work,
)
from schemas.schemas import (
    CitizenDemandCreate,
    CitizenDemandResponse,
    CitizenReportCreate,
    CitizenReportResponse,
    DemandAcknowledgement,
    EvidenceAttachmentResponse,
    NotificationMessage,
)
from services.uploads import resolve_storage_path, store_uploads

router = APIRouter()

# Characters used in this portal's receipt reference. Uppercase alphanumerics
# plus a dash: no leading character that could be mistaken for a government
# order prefix, and no character that would be ambiguous when read aloud.
_REF_ALPHABET = string.ascii_uppercase + string.digits


def _new_acknowledgement_ref() -> str:
    """This portal's own receipt id.

    Deliberately prefixed ``CPR-`` (Citizen Portal Receipt). It is not, and must
    not be presented as, a sanction order number, office order number or PFMS
    UTR — those are issued by the competent authority, not by this application.
    """
    return "CPR-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(8))


async def _notify_request_reviewers(record: CitizenDemand, attachment_count: int) -> None:
    """Notify connected accounts that can see this request in their scoped queue."""
    from routers.notifications import broadcast_notification

    targets = ["AUDITOR", "ADMIN"]
    if record.constituency_name:
        targets.append("MP")
    if record.district_name:
        targets.append("DISTRICT_AUTHORITY")
    location = ", ".join(
        part for part in (record.village, record.district_name, record.state_code) if part
    ) or "an unspecified location"
    description = (
        f"A citizen request was recorded for {location}. Open your scoped request queue to review it."
        f" Portal receipt: {record.acknowledgement_ref}."
    )
    if attachment_count:
        description += f" {attachment_count} evidence file(s) are attached."

    await broadcast_notification(
        NotificationMessage(
            category="CITIZEN_REQUEST",
            title="New citizen request received",
            description=description,
            target_id=record.acknowledgement_ref,
            severity="INFO",
            target_roles=targets,
            target_state_code=record.state_code,
            target_district_name=record.district_name,
            target_constituency_name=record.constituency_name,
        )
    )


async def _notify_report_reviewers(report: CitizenReport, attachment_count: int) -> None:
    """Notify the review roles after a site observation is durably saved."""
    from routers.notifications import broadcast_notification

    await broadcast_notification(
        NotificationMessage(
            category="CITIZEN_REPORT",
            title="New site observation received",
            description=(
                f"A citizen submitted an observation for work {report.work_id}."
                + (f" {attachment_count} evidence file(s) are attached." if attachment_count else "")
            ),
            target_id=report.work_id,
            severity="INFO",
            target_roles=["AUDITOR", "ADMIN"],
        )
    )


# ── Ground-truth reports ──────────────────────────────────────────────────────

@router.post("/report", response_model=CitizenReportResponse, status_code=201)
async def submit_citizen_report(
    report: CitizenReportCreate,
    principal: Principal = Depends(require_roles(ROLES_CITIZEN)),
    db: AsyncSession = Depends(get_db),
):
    """Submit a citizen ground-truth report for a work (no attachments).

    Use ``POST /report/with-evidence`` when the citizen has photos or a document
    to attach.
    """
    work = await _require_work(db, report.work_id)
    distance = _distance_from_work(work, report.report_lat, report.report_lon)

    db_report = CitizenReport(
        work_id=report.work_id,
        reporter_user_id=principal.user_id,
        report_lat=report.report_lat,
        report_lon=report.report_lon,
        construction_visible=report.construction_visible,
        work_complete=report.work_complete,
        matches_board_description=report.matches_board_description,
        quality_rating=report.quality_rating,
        comments=report.comments,
        distance_from_work_m=distance,
    )
    db.add(db_report)
    await db.flush()

    await write_audit_log(
        db,
        principal,
        action="citizen.report.submitted",
        entity_type="citizen_report",
        entity_id=str(db_report.report_id),
        new_value={"work_id": report.work_id, "reporter": principal.username},
    )
    await db.commit()
    await db.refresh(db_report)
    await _notify_report_reviewers(db_report, 0)
    return db_report


@router.post("/report/with-evidence", response_model=CitizenReportResponse, status_code=201)
async def submit_citizen_report_with_evidence(
    principal: Principal = Depends(require_roles(ROLES_CITIZEN)),
    db: AsyncSession = Depends(get_db),
    report: str = Form(
        ...,
        description="The report fields as a JSON object (CitizenReportCreate).",
    ),
    photos: list[UploadFile] = File(
        default_factory=list,
        description="Evidence photos or a PDF. At most 5 files.",
    ),
):
    """Submit a report together with real evidence files.

    Multipart rather than JSON because a base64 photo in a JSON body inflates
    the payload by a third and forces the whole file through memory twice.

    The JSON blob is a form field so the client does not have to duplicate the
    report structure in multipart field names. A malformed blob is a 422, not a
    500.
    """
    import json

    try:
        payload = CitizenReportCreate.model_validate(json.loads(report))
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"The 'report' form field is not a valid CitizenReportCreate object: {exc}",
        ) from exc

    work = await _require_work(db, payload.work_id)
    distance = _distance_from_work(work, payload.report_lat, payload.report_lon)

    db_report = CitizenReport(
        work_id=payload.work_id,
        reporter_user_id=principal.user_id,
        report_lat=payload.report_lat,
        report_lon=payload.report_lon,
        construction_visible=payload.construction_visible,
        work_complete=payload.work_complete,
        matches_board_description=payload.matches_board_description,
        quality_rating=payload.quality_rating,
        comments=payload.comments,
        distance_from_work_m=distance,
    )
    db.add(db_report)
    # Flush so the report has a primary key the attachments can point at.
    await db.flush()

    stored = await store_uploads(
        photos or [], owner=("report", str(db_report.report_id))
    )
    for record in stored:
        db.add(
            EvidenceAttachment(
                report_id=db_report.report_id,
                original_filename=record.original_filename,
                storage_key=record.storage_key,
                content_type=record.content_type,
                size_bytes=record.size_bytes,
                sha256=record.sha256,
                uploaded_by=principal.username,
            )
        )
    if stored:
        # Kept for compatibility with any older client reading photo_url.
        db_report.photo_url = stored[0].storage_key

    await write_audit_log(
        db,
        principal,
        action="citizen.report.submitted_with_evidence",
        entity_type="citizen_report",
        entity_id=str(db_report.report_id),
        new_value={
            "work_id": payload.work_id,
            "reporter": principal.username,
            "attachment_count": len(stored),
        },
    )
    await db.commit()
    await db.refresh(db_report)
    await _notify_report_reviewers(db_report, len(stored))
    return db_report


@router.get("/reports", response_model=list[CitizenReportResponse])
async def list_citizen_reports(
    limit: int = 50,
    offset: int = 0,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Recent citizen ground-truth reports across all works.

    The frontend previously called `GET /citizen/reports` (no path parameter),
    which did not exist, so every caller silently fell back to a hardcoded mock
    array of invented citizen testimony. This route makes the real query
    possible.

    Restricted to AUDITOR/ADMIN. These rows carry a submitter's account
    username, their submitted coordinates, and their free-text comments. A
    citizen's statement about a work is not automatically public, and this route
    previously used the anonymous ``viewer`` dependency, which would have
    exposed all of it to anyone who could reach the port.

    Note the ordering column: the previous implementation sorted by
    ``created_at``, which does not exist on this model, so every call raised.
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    result = await db.execute(
        select(CitizenReport)
        .order_by(desc(CitizenReport.submitted_at))
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


@router.get("/reports/{work_id}", response_model=list[CitizenReportResponse])
async def get_reports_for_work(
    work_id: str,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Citizen reports against one work. AUDITOR/ADMIN only, for the same reason
    as ``GET /reports``: these rows carry a submitter's identity and coordinates.
    """
    result = await db.execute(
        select(CitizenReport)
        .where(CitizenReport.work_id == work_id)
        .order_by(desc(CitizenReport.submitted_at))
    )
    return result.scalars().all()


@router.get(
    "/report/{report_id}/evidence",
    response_model=list[EvidenceAttachmentResponse],
)
async def list_report_evidence(
    report_id: UUID,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Evidence attached to one report.

    Restricted to AUDITOR/ADMIN. A citizen's photograph and comments are
    personal data attached to a named account, so the review-side listing is not
    part of the anonymous public surface.
    """
    result = await db.execute(
        select(EvidenceAttachment).where(EvidenceAttachment.report_id == report_id)
    )
    return result.scalars().all()


@router.get("/evidence/{attachment_id}/download")
async def download_evidence(
    attachment_id: UUID,
    principal: Principal = Depends(require_roles(ROLES_OFFICE)),
    db: AsyncSession = Depends(get_db),
):
    """Stream report evidence to auditors and request evidence to scoped offices.

    The frontend previously had a download control that did nothing at all
    (it showed a success toast and produced no file), because no route served
    the bytes. This is that route.

    The filename offered to the browser is taken from
    ``original_filename`` and passed through ``quote`` so a stored name
    containing spaces, quotes, or non-ASCII characters cannot corrupt the
    ``Content-Disposition`` header or inject extra header parameters.
    """
    result = await db.execute(
        select(EvidenceAttachment).where(EvidenceAttachment.attachment_id == attachment_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No such evidence attachment.",
        )

    if record.demand_id is not None:
        scope = _scope_demands(principal)
        if scope is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This request evidence is outside your jurisdiction.",
            )
        if scope is not None and not await db.scalar(
            select(CitizenDemand.demand_id).where(
                CitizenDemand.demand_id == record.demand_id, scope
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This request evidence is outside your jurisdiction.",
            )
    elif principal.role.value not in ROLES_AUDIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site observation evidence is restricted to auditor accounts.",
        )

    path = resolve_storage_path(record.storage_key)
    if not path.is_file():
        # The row exists but the file does not. Say so plainly rather than
        # returning an empty 200 that would look like a corrupt download.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "The attachment record exists but the stored file is missing from "
                "the evidence store. The record may predate a restore, or the file "
                "may have been removed."
            ),
        )

    await write_audit_log(
        db,
        principal,
        action="citizen.evidence.downloaded",
        entity_type="evidence_attachment",
        entity_id=str(record.attachment_id),
        new_value={
            "work_id": record.report.work_id if record.report else None,
            "sha256": record.sha256,
        },
    )
    await db.commit()

    # Force download, and neutralise any stored name that could be used to
    # plant a header or an extension the reviewer would misread.
    safe_name = re.sub(r'[^A-Za-z0-9._-]', "_", record.original_filename or "evidence")
    disposition = f"attachment; filename=\"{safe_name}\"; filename*=UTF-8''{quote(safe_name)}"

    return FileResponse(
        path,
        media_type=record.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": disposition,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


# ── Public demand register ───────────────────────────────────────────────────

@router.post("/demands", response_model=DemandAcknowledgement, status_code=201)
async def submit_demand(
    payload: CitizenDemandCreate,
    principal: Principal = Depends(require_roles(ROLES_CITIZEN)),
    db: AsyncSession = Depends(get_db),
):
    """Register a citizen request for a new work.

    Returns a receipt reference, not an approval. The response says so
    explicitly in ``notice`` so no part of the UI can present the reference as a
    sanction.
    """
    demand = CitizenDemand(
        acknowledgement_ref=_new_acknowledgement_ref(),
        submitted_by=principal.username,
        submitted_by_name=payload.submitted_by_name or principal.full_name,
        contact_phone=payload.contact_phone,
        contact_email=payload.contact_email or principal.email,
        state_code=(payload.state_code or "").strip().upper() or None,
        district_name=payload.district_name,
        constituency_name=payload.constituency_name,
        village=payload.village,
        work_category=payload.work_category,
        work_title=payload.work_title,
        description=payload.description,
        estimated_amount=payload.estimated_amount,
        routed_to_role="OFFICE_QUEUE",
        routed_at=datetime.utcnow(),
        status="RECEIVED",
    )
    db.add(demand)
    await db.flush()

    await write_audit_log(
        db,
        principal,
        action="citizen.demand.received",
        entity_type="citizen_demand",
        entity_id=str(demand.demand_id),
        new_value={
            "acknowledgement_ref": demand.acknowledgement_ref,
            "constituency": payload.constituency_name,
        },
    )
    await db.commit()
    await _notify_request_reviewers(demand, 0)

    return DemandAcknowledgement(
        demand_id=str(demand.demand_id),
        acknowledgement_ref=demand.acknowledgement_ref,
        status=demand.status,
        submitted_at=demand.created_at,
        notice=(
            "Your request has been recorded by this portal and is awaiting review "
            "by the competent authority. This reference is a portal receipt only — "
            "it is not a sanction order, office order number or payment reference, "
            "and no work is authorised by it."
        ),
    )


@router.post("/demands/with-evidence", response_model=DemandAcknowledgement, status_code=201)
async def submit_demand_with_evidence(
    principal: Principal = Depends(require_roles(ROLES_CITIZEN)),
    db: AsyncSession = Depends(get_db),
    demand: str = Form(..., description="CitizenDemandCreate fields as a JSON object."),
    photos: list[UploadFile] = File(default_factory=list),
):
    """Register a citizen request together with supporting evidence files."""
    import json

    try:
        payload = CitizenDemandCreate.model_validate(json.loads(demand))
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"The 'demand' form field is not a valid CitizenDemandCreate object: {exc}",
        ) from exc

    record = CitizenDemand(
        acknowledgement_ref=_new_acknowledgement_ref(),
        submitted_by=principal.username,
        submitted_by_name=payload.submitted_by_name or principal.full_name,
        contact_phone=payload.contact_phone,
        contact_email=payload.contact_email or principal.email,
        state_code=(payload.state_code or "").strip().upper() or None,
        district_name=payload.district_name,
        constituency_name=payload.constituency_name,
        village=payload.village,
        work_category=payload.work_category,
        work_title=payload.work_title,
        description=payload.description,
        estimated_amount=payload.estimated_amount,
        routed_to_role="OFFICE_QUEUE",
        routed_at=datetime.utcnow(),
        status="RECEIVED",
    )
    db.add(record)
    await db.flush()

    stored = await store_uploads(photos or [], owner=("demand", str(record.demand_id)))
    for item in stored:
        db.add(
            EvidenceAttachment(
                demand_id=record.demand_id,
                original_filename=item.original_filename,
                storage_key=item.storage_key,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                sha256=item.sha256,
                uploaded_by=principal.username,
            )
        )

    await write_audit_log(
        db,
        principal,
        action="citizen.demand.received_with_evidence",
        entity_type="citizen_demand",
        entity_id=str(record.demand_id),
        new_value={
            "acknowledgement_ref": record.acknowledgement_ref,
            "attachment_count": len(stored),
        },
    )
    await db.commit()
    await _notify_request_reviewers(record, len(stored))

    return DemandAcknowledgement(
        demand_id=str(record.demand_id),
        acknowledgement_ref=record.acknowledgement_ref,
        status=record.status,
        submitted_at=record.created_at,
        attachment_count=len(stored),
        notice=(
            "Your request and its attachments have been recorded by this portal and "
            "are awaiting review by the competent authority. This reference is a "
            "portal receipt only — it is not a sanction order, office order number "
            "or payment reference, and no work is authorised by it."
        ),
    )


@router.get("/demands/mine", response_model=list[CitizenDemandResponse])
async def list_my_demands(
    principal: Principal = Depends(require_roles(ROLES_CITIZEN)),
    db: AsyncSession = Depends(get_db),
):
    """The calling citizen's own requests, newest first.

    Scoped to the authenticated account — a citizen may only see their own
    submissions, never another account's.
    """
    result = await db.execute(
        select(CitizenDemand)
        .options(selectinload(CitizenDemand.attachments))
        .where(CitizenDemand.submitted_by == principal.username)
        .order_by(desc(CitizenDemand.created_at))
        .limit(100)
    )
    return result.scalars().all()


# ── Officer-side request queue ─────────────────────────────────────────────────
#
# These two routes exist because the MP and district desks previously had
# nothing real to call. `auth.tsx` kept a localStorage array of requests, the MP
# page showed an "Endorse & Recommend for MPLADS Sanction" button that only
# rewrote a status string, and the district page answered it with a fabricated
# `SO-KAN-0004128` order number and a random `PFMS4401928371` UTR.
#
# So the two pages had to invent an office. Giving them real, jurisdiction-scoped
# reads of the same rows, plus a decision that is recorded against the acting
# account, replaces both the invention and the no-op button.
#
# What this deliberately does NOT do: sanction a work, allocate a fund, or emit
# any government order identifier. An MP or district office acting inside this
# application can acknowledge a request and leave a note. That is the limit of
# what an application can do on an office's behalf, and the response says so.


def _scope_demands(principal: Principal):
    """Restrict a demand query to the caller's jurisdiction.

    An MP sees only their own constituency, a district officer only their own
    district, and an auditor or admin sees everything. When the account carries
    no jurisdiction at all, the result is empty rather than national: a missing
    scope must not silently widen someone's view.

    The state is required, not optional. This previously applied the state clause
    only when one happened to be provisioned and fell back to a name-only match
    otherwise, and the test suite asserted that fallback. That is the wrong way
    round: an account with a name but no state is an incompletely provisioned
    account, not an account entitled to a national search. Constituency and
    district names both repeat between states, so a name-only scope silently
    widens to every other state carrying the same name, and doing it only when
    the state field is blank makes the leak depend on a data-entry omission.
    Fail closed instead, and make the operator complete the account record.
    """
    if principal.role in (Role.AUDITOR, Role.ADMIN):
        return None  # no restriction

    if principal.role is Role.MP:
        # Both fields, or nothing. A name alone is not a scope: see below.
        if not principal.constituency_name or not principal.state_code:
            return False
        return and_(
            CitizenDemand.constituency_name.ilike(principal.constituency_name),
            CitizenDemand.state_code == principal.state_code,
        )

    if principal.role is Role.DISTRICT_AUTHORITY:
        if not principal.district_name or not principal.state_code:
            return False
        return and_(
            CitizenDemand.district_name.ilike(principal.district_name),
            CitizenDemand.state_code == principal.state_code,
        )

    # Any other authenticated office role: no basis for a scope, so no rows.
    return False


@router.get("/demands", response_model=list[CitizenDemandResponse])
async def list_demands_for_office(
    principal: Principal = Depends(require_roles(ROLES_OFFICE)),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        description="Exact internal routing status to filter on.",
    ),
):
    """Requests within the caller's jurisdiction, newest first.

    Scoping is decided from the account record, not from a query parameter, so a
    client cannot ask for another MP's or another district's requests.
    """
    scope = _scope_demands(principal)
    if scope is False:
        # The account has no jurisdiction to scope to. Returning an empty list
        # with a reason is better than returning every request on the table.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account does not have a complete jurisdiction, so no requests can be "
                "scoped to it. Both the constituency or district name and the state are "
                "required: names repeat between states, so a name on its own is not a scope. "
                "An operator must complete the account record before this queue can be used."
            ),
        )

    query = select(CitizenDemand).options(selectinload(CitizenDemand.attachments))
    if scope is not None:
        query = query.where(scope)
    if status_filter:
        query = query.where(CitizenDemand.status == status_filter.upper())

    result = await db.execute(
        query.order_by(desc(CitizenDemand.created_at)).limit(limit)
    )
    return result.scalars().all()


class DemandDecision(BaseModel):
    """A reviewer's note on a request.

    ``decision`` is limited to what this application can honestly record about a
    request's internal routing. It is not a sanction, a rejection on merit, or a
    funding decision, and it emits no government order number.
    """

    decision: Literal["ACKNOWLEDGE"] = Field(
        ...,
        description=(
            "Only ACKNOWLEDGE is accepted. This application cannot sanction, "
            "reject or forward a request to any government system."
        ),
    )
    note: str = Field(..., min_length=3, max_length=4000)
    routed_to_role: Optional[Role] = Field(
        default=None,
        description="Which internal office queue the request should sit in next.",
    )

    @field_validator("routed_to_role")
    @classmethod
    def _office_role_only(cls, value: Optional[Role]) -> Optional[Role]:
        """Reject routing a request to a non-office role.

        The column records which *office* queue a request sits in. Accepting the
        whole ``Role`` enum would let a caller file a request under
        ``PUBLIC`` or ``CITIZEN``, which are not queues and do not have an
        inbox, so the value would be meaningless at best and a way to make a
        request invisible to reviewers at worst.
        """
        if value is not None and value not in ROLES_OFFICE:
            raise ValueError(
                "routed_to_role must be an office role that can hold a queue "
                f"({', '.join(sorted(r.value for r in ROLES_OFFICE))}); "
                f"{value.value} is not one."
            )
        return value


@router.post("/demands/{demand_id}/review", response_model=CitizenDemandResponse)
async def review_demand(
    demand_id: UUID,
    payload: DemandDecision,
    principal: Principal = Depends(require_roles(ROLES_OFFICE)),
    db: AsyncSession = Depends(get_db),
):
    """Record a reviewer's acknowledgement against a request.

    This is the real operation behind what the UI used to call "endorse". It
    writes ``ACKNOWLEDGED``, the acting account, the timestamp and the note, and
    leaves an audit entry. It does not approve a work, commit money, or contact
    any office outside this database.
    """
    result = await db.execute(
        select(CitizenDemand)
        .options(selectinload(CitizenDemand.attachments))
        .where(CitizenDemand.demand_id == demand_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(404, f"Request {demand_id} not found")

    scope = _scope_demands(principal)
    if scope is False or (scope is not None and not await db.scalar(
        select(CitizenDemand.demand_id).where(
            CitizenDemand.demand_id == demand_id, scope
        )
    )):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This request is outside your jurisdiction.",
        )

    if record.status == "WITHDRAWN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This request was withdrawn and cannot be reviewed.",
        )

    previous = record.status
    record.status = "ACKNOWLEDGED"
    record.decision_note = payload.note
    record.decided_by = principal.username
    record.decided_at = datetime.utcnow()
    if payload.routed_to_role is not None:
        record.routed_to_role = payload.routed_to_role.value

    await write_audit_log(
        db,
        principal,
        action="citizen.demand.acknowledged",
        entity_type="citizen_demand",
        entity_id=str(record.demand_id),
        old_value={"status": previous},
        new_value={
            "status": record.status,
            "routed_to_role": record.routed_to_role,
            "note": payload.note,
        },
    )
    await db.commit()
    result = await db.execute(
        select(CitizenDemand)
        .options(selectinload(CitizenDemand.attachments))
        .where(CitizenDemand.demand_id == demand_id)
    )
    return result.scalar_one()


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _require_work(db: AsyncSession, work_id: str) -> Work:
    result = await db.execute(select(Work).where(Work.work_id == work_id))
    work = result.scalar_one_or_none()
    if work is None:
        raise HTTPException(404, f"Work {work_id} not found")
    return work


def _distance_from_work(work: Work, lat: float, lon: float) -> Optional[float]:
    """Great-circle distance between the report and the work's stored point.

    Returns ``None`` when the work has no coordinates. The stored point is a
    place centroid (see ``Work.coordinate_precision``), so this distance
    measures agreement with an administrative locality, not the precision of a
    surveyed work location.
    """
    if work.reported_lat is None or work.reported_lon is None:
        return None
    radius = 6371000.0
    lat1, lat2 = math.radians(work.reported_lat), math.radians(lat)
    dlat = math.radians(lat - work.reported_lat)
    dlon = math.radians(lon - work.reported_lon)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * radius * math.asin(math.sqrt(a)), 1)
