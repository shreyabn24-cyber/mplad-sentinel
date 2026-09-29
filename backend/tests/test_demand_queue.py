"""
Tests for the office request queue and review routes.

These run without PostgreSQL: the database dependency is replaced with a stub
that records the statement it was handed, so the assertions are about the
*access decision* and the *shape of the scope clause* rather than about rows.

The bug this file exists to catch: `_scope_demands` originally matched an MP or
district account on the jurisdiction *name* alone. Constituency and district
names are not unique across India, so an account provisioned with
"Barannagar" (West Bengal) also matched requests from every other state with a
constituency of that name, and a district officer in one state saw another
state's requests. The scope must include the state.

Run:  python -m pytest backend/tests -q
"""

from __future__ import annotations

import re
import secrets as _secrets
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND.parent
for candidate in (str(BACKEND), str(REPO_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from config import settings  # noqa: E402

# The shipped .env carries a template SECRET_KEY that the signing guard rejects.
settings.SECRET_KEY = _secrets.token_urlsafe(48)

import main as app_module  # noqa: E402
from auth import Principal, Role, hash_password  # noqa: E402
from database import get_db  # noqa: E402
from models.models import CitizenDemand, User  # noqa: E402
from routers.citizen import DemandDecision, _scope_demands  # noqa: E402


# ── Compiling the scope clause to text ───────────────────────────────────────
#
# Asserting on a compiled string is the only way to check a SQLAlchemy
# expression without a database. The parameter *values* are checked separately
# so the assertion cannot pass just because a name happens to appear as SQL
# text.


def _scope_sql(principal: Principal) -> str:
    scope = _scope_demands(principal)
    assert scope is not False, "expected a scope clause, got False (no jurisdiction)"
    assert scope is not None, "expected a scope clause, got None (unrestricted)"
    return str(scope.compile(compile_kwargs={"literal_binds": True}))


def _principal(**overrides) -> Principal:
    defaults = {
        "user_id": str(uuid.uuid4()),
        "username": "office.account",
        "role": Role.MP,
        "is_authenticated": True,
    }
    defaults.update(overrides)
    return Principal(**defaults)


# ── The scope must be state-aware ────────────────────────────────────────────


def test_mp_scope_includes_state_code():
    """An MP is scoped by constituency *and* state, not constituency alone."""
    scope = _scope_demands(
        _principal(
            role=Role.MP,
            constituency_name="Barannagar",
            state_code="WB",
        )
    )
    sql = _scope_sql(_principal(role=Role.MP, constituency_name="Barannagar", state_code="WB"))
    assert "constituency_name" in sql.lower()
    assert "state_code" in sql.lower(), (
        "MP scope must constrain the state. Constituency names repeat across "
        "states, so matching on the name alone leaks another state's requests."
    )
    # The two predicates must be ANDed, not ORed. An OR would be worse than no
    # scope at all: it would match every request in the state.
    assert " AND " in sql.upper(), f"expected an AND of both predicates, got: {sql}"
    assert "'WB'" in sql
    assert scope is not False


def test_district_scope_includes_state_code():
    """A district officer is scoped by district *and* state."""
    scope = _scope_demands(
        _principal(
            role=Role.DISTRICT_AUTHORITY,
            district_name="Kannauj",
            state_code="UP",
        )
    )
    assert scope is not False
    sql = str(scope.compile(compile_kwargs={"literal_binds": True}))
    assert "district_name" in sql.lower()
    assert "state_code" in sql.lower(), (
        "District scope must constrain the state. District names repeat across "
        "states, so matching on the name alone leaks another state's requests."
    )
    assert " AND " in sql.upper(), f"expected an AND of both predicates, got: {sql}"


@pytest.mark.parametrize(
    "role, jurisdiction",
    [
        (Role.MP, "constituency_name"),
        (Role.DISTRICT_AUTHORITY, "district_name"),
    ],
)
def test_name_without_state_fails_closed(role, jurisdiction):
    """A jurisdiction name with no state on the account must not become a scope.

    This is the case that was previously "helped" by falling back to a name-only
    match. Constituency and district names both repeat between states, so that
    fallback widened the account's view to every other state sharing the name -
    and only when the state field happened to be blank, which made the leak
    depend on a data-entry omission rather than on anything the code decided.
    """
    scope = _scope_demands(_principal(role=role, **{jurisdiction: "Somewhere"}))
    assert scope is False, (
        "a name with no state is an incompletely provisioned account, not a "
        "licence to search every state carrying that name. Return no scope and "
        "let the operator finish the account record."
    )


@pytest.mark.parametrize(
    "role, jurisdiction",
    [
        (Role.MP, "constituency_name"),
        (Role.DISTRICT_AUTHORITY, "district_name"),
    ],
)
def test_no_jurisdiction_at_all_fails_closed(role, jurisdiction):
    """No name and no state means no rows - never an unrestricted query."""
    assert _scope_demands(_principal(role=role)) is False


def test_auditor_and_admin_are_unrestricted():
    """Auditors and admins legitimately see every request."""
    for role in (Role.AUDITOR, Role.ADMIN):
        assert _scope_demands(_principal(role=role)) is None


@pytest.mark.parametrize("role", [Role.PUBLIC, Role.CITIZEN])
def test_non_office_roles_have_no_scope(role):
    """A citizen or anonymous caller has no office queue to read."""
    assert _scope_demands(_principal(role=role)) is False


# ── routed_to_role may only name a queue that can hold a request ─────────────


@pytest.mark.parametrize("role", [Role.MP, Role.DISTRICT_AUTHORITY, Role.AUDITOR, Role.ADMIN])
def test_office_routing_roles_are_accepted(role):
    """Every office role that can actually hold a queue is accepted."""
    assert DemandDecision(
        decision="ACKNOWLEDGE", note="noted", routed_to_role=role
    ).routed_to_role is role


def test_routing_to_public_is_rejected():
    """PUBLIC is the anonymous read class, not a queue.

    Routing a request to it would park the request where no reviewer can see it.
    """
    with pytest.raises(ValueError) as exc:
        DemandDecision(decision="ACKNOWLEDGE", note="noted", routed_to_role=Role.PUBLIC)
    assert "PUBLIC" in str(exc.value)


def test_routing_to_citizen_is_rejected():
    """CITIZEN is the submitter, not a reviewing queue."""
    with pytest.raises(ValueError) as exc:
        DemandDecision(decision="ACKNOWLEDGE", note="noted", routed_to_role=Role.CITIZEN)
    assert "CITIZEN" in str(exc.value)


def test_routing_may_be_omitted():
    assert DemandDecision(decision="ACKNOWLEDGE", note="noted").routed_to_role is None


@pytest.mark.parametrize("note", ["", "ab"])
def test_note_must_be_meaningful(note):
    """An acknowledgement with no note records nothing reviewable."""
    with pytest.raises(ValueError):
        DemandDecision(decision="ACKNOWLEDGE", note=note)


# ── HTTP surface ─────────────────────────────────────────────────────────────


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _Result:
    def __init__(self, rows=(), scalar=None, one=None):
        self._rows = rows
        self._scalar = scalar
        self._one = one

    def scalars(self):
        return _Scalars(self._rows)

    def scalar(self):
        return self._scalar

    def scalar_one_or_none(self):
        # The auth layer resolves the account with this call. A demand query
        # must never answer it, hence the explicit `_one` rather than a fallback
        # to the first row.
        if self._one is not None:
            return self._one
        return self._rows[0] if len(self._rows) == 1 else None

    def scalar_one(self):
        if self._one is not None:
            return self._one
        if len(self._rows) != 1:
            raise AssertionError(f"expected one row, received {len(self._rows)}")
        return self._rows[0]


class _DemandStubSession:
    """Records statements and answers the demand queries from a row list.

    The ``WHERE`` clause is *not* ignored. A stub that returns the first row for
    every query would pass a cross-state access test no matter what the scope
    expression did, because the answer would be "found" either way - so the
    scope tests would be decoration. Instead the bound parameters are applied to
    the in-memory rows by column name, which is enough for the equality and
    ``ilike`` predicates these routes build.
    """

    def __init__(self):
        self.account: User | None = None
        self.demands: list[CitizenDemand] = []
        self.statements: list[str] = []
        self._last_statement = None
        self.audit_entries: list[object] = []
        self.committed = False

    def _record(self, statement) -> str:
        self._last_statement = statement
        text = str(statement)
        self.statements.append(text)
        return text

    def _matching(self, statement) -> list[CitizenDemand]:
        rows = list(self.demands)
        for name, value in (statement.compile().params or {}).items():
            column = name.rsplit("_", 1)[0]
            if not hasattr(CitizenDemand, column):
                continue
            wanted = str(value).lower()
            rows = [
                r
                for r in rows
                if str(getattr(r, column, None) or "").lower() == wanted
            ]
        return rows

    async def execute(self, statement):
        text = self._record(statement)
        if "users" in text:
            return _Result(one=self.account)
        rows = self._matching(statement)
        return _Result(rows=rows, scalar=rows[0] if rows else None)

    async def get(self, model, pk):
        for row in self.demands:
            if isinstance(row, model) and str(row.demand_id) == str(pk):
                return row
        return None

    async def scalar(self, statement):
        self._record(statement)
        rows = self._matching(statement)
        return rows[0] if rows else None

    def add(self, obj):
        self.audit_entries.append(obj)

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        return None

    async def flush(self):
        return None


def _user(**overrides) -> User:
    defaults = {
        "user_id": uuid.uuid4(),
        "username": "office.account",
        "email": "office@example.invalid",
        "hashed_password": hash_password("unused"),
        "full_name": "Office Account",
        "role": "MP",
        "is_active": True,
        # The column is `jurisdiction_state`; `Principal.state_code` is what the
        # auth layer maps it onto. Passing `state_code` here would be a TypeError
        # and would silently leave every jurisdiction assertion unscoped.
        "jurisdiction_state": None,
    }
    defaults.update(overrides)
    return User(**defaults)


def _demand(**overrides) -> CitizenDemand:
    from datetime import datetime, timezone

    defaults = {
        "demand_id": uuid.uuid4(),
        "acknowledgement_ref": "REQ-ABC123",
        "submitted_by": "citizen.one",
        "submitted_by_name": "Citizen One",
        "state_code": "UP",
        "district_name": "Kannauj",
        "constituency_name": "Kannauj",
        "village": "Somewhere",
        "work_category": "ROAD",
        "work_title": "Approach road",
        "description": "Please build it.",
        "status": "SUBMITTED",
        "created_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return CitizenDemand(**defaults)


@pytest.fixture
def office_client():
    session = _DemandStubSession()

    def _override_get_db():
        yield session

    app_module.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app_module.app, raise_server_exceptions=False), session
    finally:
        app_module.app.dependency_overrides.pop(get_db, None)


def _auth(session: _DemandStubSession, **overrides) -> dict:
    # Tests reason about `state_code` because that is what `Principal` exposes
    # and what the scope clause compares. The column it comes from is
    # `jurisdiction_state`, so translate rather than letting a test that looks
    # scoped silently produce an account with no state at all.
    if "state_code" in overrides:
        overrides["jurisdiction_state"] = overrides.pop("state_code")
    session.account = _user(**overrides)
    from auth import create_access_token

    token, _ = create_access_token(
        user_id=str(session.account.user_id),
        username=session.account.username,
        role=Role(session.account.role),
    )
    return {"Authorization": f"Bearer {token}"}


def test_queue_requires_authentication(office_client):
    client, _ = office_client
    assert client.get("/api/v1/citizen/demands").status_code in (401, 403)


def test_citizen_cannot_read_the_office_queue(office_client):
    client, session = office_client
    headers = _auth(session, role="CITIZEN")
    assert client.get("/api/v1/citizen/demands", headers=headers).status_code == 403


def test_queue_with_no_jurisdiction_is_refused_with_a_reason(office_client):
    """An MP account with no constituency must be told why, not shown nothing.

    An empty list is indistinguishable from "no requests exist", which would let
    a provisioning mistake pass unnoticed for months.
    """
    client, session = office_client
    headers = _auth(session, role="MP", constituency_name=None, district_name=None)
    response = client.get("/api/v1/citizen/demands", headers=headers)
    assert response.status_code == 403
    assert "jurisdiction" in response.json()["detail"].lower()


def test_mp_queue_query_constrains_state(office_client):
    """The SQL actually sent for an MP must filter on the state column."""
    client, session = office_client
    headers = _auth(session, role="MP", constituency_name="Kannauj", state_code="UP")
    response = client.get("/api/v1/citizen/demands", headers=headers)
    assert response.status_code == 200, response.text
    # Values are bound parameters, not inline literals, so check the params.
    statement = session._last_statement
    params = statement.compile().params
    assert "state_code" in session.statements[-1].lower(), (
        f"state not constrained in: {session.statements[-1]}"
    )
    assert "UP" in {str(v) for v in params.values()}, (
        f"expected the account's state bound into the query, got params {params}"
    )


def test_review_outside_jurisdiction_is_forbidden(office_client):
    client, session = office_client
    session.demands = [_demand(state_code="UP", district_name="Kannauj")]
    headers = _auth(session, role="DISTRICT_AUTHORITY", district_name="Kannauj", state_code="WB")
    response = client.post(
        f"/api/v1/citizen/demands/{session.demands[0].demand_id}/review",
        headers=headers,
        json={"decision": "ACKNOWLEDGE", "note": "seen in another state"},
    )
    assert response.status_code == 403
    assert not session.committed, "a refused review must not be committed"


def test_withdrawn_demand_cannot_be_reviewed(office_client):
    client, session = office_client
    session.demands = [_demand(status="WITHDRAWN")]
    headers = _auth(session, role="MP", constituency_name="Kannauj", state_code="UP")
    response = client.post(
        f"/api/v1/citizen/demands/{session.demands[0].demand_id}/review",
        headers=headers,
        json={"decision": "ACKNOWLEDGE", "note": "cannot be actioned"},
    )
    assert response.status_code == 409
    assert not session.committed


def test_review_records_account_note_and_audit(office_client):
    """The acknowledgement is attributable, which is the whole point of it."""
    client, session = office_client
    record = _demand(status="SUBMITTED")
    session.demands = [record]
    headers = _auth(
        session,
        role="MP",
        username="mp.kan nauj",
        constituency_name="Kannauj",
        state_code="UP",
    )
    response = client.post(
        f"/api/v1/citizen/demands/{record.demand_id}/review",
        headers=headers,
        json={
            "decision": "ACKNOWLEDGE",
            "note": "Recorded in the constituency office register.",
            "routed_to_role": "DISTRICT_AUTHORITY",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ACKNOWLEDGED"
    assert body["decided_by"] == "mp.kan nauj"
    assert body["routed_to_role"] == "DISTRICT_AUTHORITY"
    assert re.search(r"noted|register", body["decision_note"], re.I)
    assert session.committed
    assert session.audit_entries, "review must leave an audit entry"


def test_review_response_is_not_an_order_number(office_client):
    """The receipt ref is the portal's own id and must not look like an order.

    The previous implementation minted ``SO-KAN-123456`` sanction orders, so any
    identifier in this payload has to stay clearly outside that shape.
    """
    client, session = office_client
    record = _demand(acknowledgement_ref="REQ-ABC123")
    session.demands = [record]
    headers = _auth(session, role="MP", constituency_name="Kannauj", state_code="UP")
    response = client.post(
        f"/api/v1/citizen/demands/{record.demand_id}/review",
        headers=headers,
        json={"decision": "ACKNOWLEDGE", "note": "noted for the record"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["acknowledgement_ref"] == "REQ-ABC123"
    serialized = " ".join(str(v) for v in body.values() if isinstance(v, str))
    assert not re.search(r"\bSO-[A-Z]{2,}-\d+\b", serialized), (
        "response must not contain a sanction-order-shaped identifier"
    )
    assert not re.search(r"\bPFMS\b", serialized), (
        "response must not contain a PFMS reference"
    )
