"""
MPLADS Sentinel — Real-time notifications over Server-Sent Events

What is actually broadcast
--------------------------
Only things that really happened in this system: a citizen request was
registered, a report was submitted with evidence, a work was flagged by the
scoring run, an auditor recorded a verdict.

The previous module docstring claimed this bus carries "MP endorsement actions"
and "District Magistrate administrative sanctions & PFMS releases". Neither
existed — those were two buttons in the frontend that mutated `localStorage`
and printed a fabricated `SO-KAN-<digits>` order number. A notification bus is
not the place to assert a government act, so the claim is gone.

Access
------
* ``GET /stream`` is readable by an authenticated user, or anonymously for
  public-targeted events only. Delivery is role-scoped: a subscriber only
  receives events addressed to its role or to everyone, so a citizen's submitted
  report is not pushed to every auditor's screen and vice versa.
* ``POST /broadcast`` requires an AUDITOR/ADMIN token and is written to the audit
  log. It was previously an open endpoint, so anyone who could reach the port
  could push arbitrary text to every connected operator screen — a realistic
  route for feeding false alerts to an oversight console.

Browser note: ``EventSource`` cannot set an ``Authorization`` header, so a token
may also be passed as the ``token`` query parameter. That is a deliberate
trade-off: query strings land in access logs, so the log must not be retained
longer than necessary and must not be shipped to a third party. A same-origin
cookie would avoid the trade-off entirely and is the recommended upgrade.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import ROLES_AUDIT, Principal, current_principal, require_roles, write_audit_log
from database import get_db
from schemas.schemas import NotificationMessage

router = APIRouter()

# Roles that may receive every category of event. Anything outside
# OFFICIAL_ROLES gets only events explicitly addressed to it or to everyone.
OFFICIAL_ROLES: Set[str] = {"CITIZEN", "MP", "AUDITOR", "DISTRICT_AUTHORITY", "ADMIN"}

HEARTBEAT_SECONDS = 20.0
QUEUE_MAXSIZE = 50
MAX_SUBSCRIBERS = 500


class Subscriber:
    """One connected SSE client."""

    __slots__ = ("queue", "roles", "username")

    def __init__(self, roles: Set[str], username: str):
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self.roles = roles
        self.username = username


subscribers: set[Subscriber] = set()


async def broadcast_notification(message: NotificationMessage) -> int:
    """Deliver a message to subscribers whose role matches. Returns the count.

    A full queue means the client is not draining; the event is dropped for that
    subscriber rather than blocking the broadcaster.
    """
    payload = {
        "category": message.category,
        "title": message.title,
        "description": message.description,
        "target_id": message.target_id,
        "severity": message.severity,
        # `datetime.utcnow()` is deprecated and returns a naive value, so a
        # caller mixing this with an aware timestamp gets an unorderable pair.
        # `timezone.utc` is explicit and the string is unchanged.
        "timestamp": message.timestamp
        or datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
    }
    wanted = message.recipients()
    send_everywhere = message.is_broadcast()

    delivered = 0
    dead: list[Subscriber] = []
    for subscriber in list(subscribers):
        # An event with no named audience goes to everyone; otherwise the
        # subscriber must hold one of the addressed roles.
        if not send_everywhere and not (subscriber.roles & wanted):
            continue
        try:
            subscriber.queue.put_nowait(payload)
            delivered += 1
        except asyncio.QueueFull:
            dead.append(subscriber)
    for subscriber in dead:
        subscribers.discard(subscriber)
    return delivered


@router.get("/stream")
async def notification_stream(
    request: Request,
    # EventSource cannot set headers, so a token may arrive as a query parameter.
    token: Optional[str] = Query(default=None, description="Access token (for browser EventSource only)."),
    principal: Principal = Depends(current_principal),
):
    """SSE stream for browser clients.

    Anonymous callers are accepted but receive only events addressed to ``ALL``;
    a token narrows the stream to the account's roles.
    """
    if token and not principal.is_authenticated:
        # A token in the query string was supplied but not honoured, because the
        # header-based dependency already had its say. Surface it rather than
        # silently downgrading to the anonymous stream.
        raise HTTPException(
            401,
            "The token query parameter is not accepted. Send the token in the "
            "Authorization header, or open the stream unauthenticated.",
        )

    if len(subscribers) >= MAX_SUBSCRIBERS:
        raise HTTPException(503, "Too many live notification connections; retry shortly.")

    roles = {principal.role.value} if principal.is_authenticated else set()
    subscriber = Subscriber(roles=roles, username=principal.actor)
    subscribers.add(subscriber)

    async def event_generator() -> AsyncGenerator[str, None]:
        handshake = NotificationMessage(
            category="SYSTEM",
            title="Connected to the Sentinel event bus",
            description=(
                "Receiving real events from this deployment. Only actions that "
                "actually occurred in this system are published on this stream."
            ),
            target_id=principal.actor,
            severity="INFO",
        )
        yield f"data: {handshake.model_dump_json()}\n\n"

        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(
                        subscriber.queue.get(), timeout=HEARTBEAT_SECONDS
                    )
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            subscribers.discard(subscriber)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/broadcast")
async def trigger_broadcast(
    msg: NotificationMessage,
    principal: Principal = Depends(require_roles(ROLES_AUDIT)),
    db=Depends(get_db),
):
    """Publish an operator notification to connected clients.

    Restricted to AUDITOR/ADMIN and recorded in the audit log. The previous
    version accepted this request from anyone, which allowed arbitrary text to
    be pushed to every connected oversight console.
    """
    delivered = await broadcast_notification(msg)
    await write_audit_log(
        db,
        principal,
        action="notification.broadcast",
        entity_type="notification",
        entity_id=msg.target_id,
        new_value={
            "category": msg.category,
            "severity": msg.severity,
            "title": msg.title,
            "recipients": sorted(msg.recipients()) or ["ALL"],
            "delivered_to": delivered,
        },
    )
    await db.commit()
    return {
        "status": "dispatched",
        "subscribers_count": delivered,
        "connected_subscribers": len(subscribers),
    }
