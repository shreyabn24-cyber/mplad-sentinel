"""MP identity must not leak through the anonymous anomaly list.

The public endpoint ``GET /api/v1/anomalies/`` is readable without a token. It
used to mask L1/L2 and return the raw MP id for L3, so the anonymous public list
disclosed the full identity of the MP behind every most-serious flag. The L3
disclosure path is the AUDITOR/ADMIN-only ``GET /api/v1/anomalies/l3/``.

These tests drive the real routes through a stub session so the assertions are
about what the router puts in the response, not about the masking helper in
isolation. Two separate bugs are covered:

  1. the public list leaked L3 identity;
  2. ``/l3/`` delegated to ``list_anomalies`` and therefore inherited its
     masking, so the audit-only view returned a masked id as well — masked in the
     public place, masked in the private place.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import main as app_module
from auth import Role, create_access_token, hash_password
from database import get_db
from models.models import User


class _Result:
    """Serves both result shapes the routes under test need."""

    def __init__(self, rows, user):
        self._rows = rows
        self._user = user

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._user


_TIERS = ("L1", "L2", "L3")


class _AnomalySession:
    """Fixed (work, risk) rows for the flag queries, and one account for auth.

    The auth dependency re-reads the account from the database on every request,
    so a token is not enough to reach an AUDITOR route: the stub has to answer
    that lookup too, or the request is refused before the router runs.

    The stub cannot evaluate a WHERE clause, but it can honour the one that
    matters here: the tier equality the L3 route adds. Without that, the L3 route
    would "pass" a test that asserted it had filtered to a single row, because
    the stub would hand back all three tiers and the bug of a missing tier
    filter would be invisible.
    """

    def __init__(self, rows, account=None):
        self.rows = rows
        self.account = account
        self.statements: list[str] = []

    async def execute(self, statement):
        self.statements.append(str(statement))

        params = statement.compile().params or {}
        bound = {v for v in params.values() if isinstance(v, str)}
        tier = next((t for t in _TIERS if t in bound), None)

        rows = self.rows
        if tier is not None:
            rows = [(w, r) for w, r in rows if (r.confidence_tier or "L1") == tier]
        return _Result(rows, self.account)


def _auditor() -> User:
    return User(
        user_id=uuid.UUID("66666666-6666-6666-6666-666666666666"),
        username="auditor.one",
        email="auditor.one@example.invalid",
        hashed_password=hash_password("not-used-in-this-path"),
        full_name="Auditor One",
        role="AUDITOR",
        is_active=True,
    )


def _auditor_headers() -> dict[str, str]:
    token, _ = create_access_token(
        user_id="66666666-6666-6666-6666-666666666666",
        username="auditor.one",
        role=Role.AUDITOR,
    )
    return {"Authorization": f"Bearer {token}"}


def _work(work_id: str, mp_id: str, tier_work_type: str = "ROAD"):
    from models.models import Work

    return Work(
        work_id=work_id,
        mp_id=mp_id,
        work_type=tier_work_type,
        work_description="test work",
        district_name="Kannauj",
        district_code="UP159",
        state_code="UP",
        constituency_name="Kannauj",
        sanction_amount=Decimal("1000000.00"),
        sanction_date=date(2020, 1, 1),
    )


def _risk(work_id: str, tier: str, score: float):
    from models.models import RiskScore

    return RiskScore(
        score_id=f"score-{work_id}",
        work_id=work_id,
        composite_score=score,
        confidence_tier=tier,
        auditor_reviewed=False,
        evidence_chain={"GHOST_FUNDING": {"score": 0.9}},
    )


@pytest.fixture
def anomaly_client():
    rows = [
        (_work("MPLAD-AAA-1", "MP-LOKRAJA-0001"), _risk("MPLAD-AAA-1", "L1", 20.0)),
        (_work("MPLAD-BBB-2", "MP-SUBHASH-0002"), _risk("MPLAD-BBB-2", "L2", 50.0)),
        (_work("MPLAD-CCC-3", "MP-RAJEEV-0003"), _risk("MPLAD-CCC-3", "L3", 90.0)),
    ]
    session = _AnomalySession(rows, account=_auditor())

    def _override_get_db():
        yield session

    app_module.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app_module.app, raise_server_exceptions=False), session
    finally:
        app_module.app.dependency_overrides.pop(get_db, None)


def _mp_ids(payload):
    return {card["work_id"]: card["mp_id_masked"] for card in payload}


def test_public_anonymous_list_masks_every_tier_including_l3(anomaly_client):
    """No token. L3 must be masked like everything else."""
    client, _ = anomaly_client

    response = client.get("/api/v1/anomalies/")
    assert response.status_code == 200, response.text

    ids = _mp_ids(response.json())
    assert set(ids) == {"MPLAD-AAA-1", "MPLAD-BBB-2", "MPLAD-CCC-3"}

    for work_id, masked in ids.items():
        assert masked is not None, f"{work_id} lost its masked field entirely"
        assert "***" in masked, (
            f"{work_id} returned {masked!r} unmasked on the anonymous list"
        )

    # The specific leak: an L3 row must not carry the real MP id.
    assert ids["MPLAD-CCC-3"] == "MP-RAJEEV-***"
    for raw in ("MP-RAJEEV-0003", "MP-SUBHASH-0002", "MP-LOKRAJA-0001"):
        assert raw not in response.text, (
            f"{raw} appears verbatim in the anonymous response body"
        )


def test_auditor_l3_view_does_disclose_the_identity(anomaly_client):
    """The audit path must actually be the unmasked one, or it is pointless.

    It used to call `list_anomalies`, which applied the public masking, so an
    auditor asking for the unmasked view got a masked id back.
    """
    client, _ = anomaly_client

    response = client.get("/api/v1/anomalies/l3/", headers=_auditor_headers())
    assert response.status_code == 200, response.text

    payload = response.json()
    assert [card["work_id"] for card in payload] == ["MPLAD-CCC-3"]
    assert payload[0]["mp_id_masked"] == "MP-RAJEEV-0003", (
        "the AUDITOR/ADMIN-only L3 view must carry the real MP id; if this fails "
        "the view is masking, which is the bug it was added to fix"
    )


def test_public_list_cannot_be_asked_to_reveal_identity(anomaly_client):
    """No query parameter may switch the disclosure on.

    `reveal_mp_identity` is a private helper argument rather than a field on the
    route, so there is nothing for a caller to send.
    """
    client, _ = anomaly_client

    response = client.get(
        "/api/v1/anomalies/", params={"reveal_mp_identity": "true"}
    )
    assert response.status_code == 200, response.text
    assert "MP-RAJEEV-0003" not in response.text


def test_anonymous_caller_is_refused_the_l3_view(anomaly_client):
    client, _ = anomaly_client

    # No token at all: 401 before the router runs.
    assert client.get("/api/v1/anomalies/l3/").status_code == 401
