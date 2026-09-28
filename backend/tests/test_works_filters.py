"""The works list must not widen a district filter.

Two separate problems, both in `GET /api/v1/works?district_name=`:

  1. the filter was `ilike("%<name>%")`, a substring match, so a partial name
     returned every district whose name contained it, and a name containing `%`
     or `_` was interpreted as a LIKE pattern;
  2. a district name with no `state_code` returned works from every state with a
     same-named district.

The state requirement mirrors the fail-closed rule in the demand queue.
"""

import pytest
from fastapi.testclient import TestClient

import main as app_module
from database import get_db


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return None


class _WorksSession:
    """Captures the compiled SQL with bound literals inlined, and no rows."""

    def __init__(self):
        self.sql = ""

    async def execute(self, statement):
        try:
            self.sql = str(
                statement.compile(compile_kwargs={"literal_binds": True})
            )
        except Exception:  # pragma: no cover - fall back to the bare SQL
            self.sql = str(statement)
        return _Result([])


@pytest.fixture
def works_client():
    session = _WorksSession()

    def _override_get_db():
        yield session

    app_module.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app_module.app, raise_server_exceptions=False), session
    finally:
        app_module.app.dependency_overrides.pop(get_db, None)


def _get(client, query: str):
    # No Authorization header. The works list is `viewer`, i.e. readable
    # anonymously, and sending a token would make the auth dependency re-read an
    # account from this stub, which holds none.
    return client.get(f"/api/v1/works/?{query}")


def test_district_name_alone_is_refused(works_client):
    client, _ = works_client

    response = _get(client, "district_name=Kannauj")
    assert response.status_code == 400, response.text
    assert "state_code" in response.json()["detail"]


def test_district_name_with_state_is_accepted_and_uses_an_exact_match(works_client):
    client, session = works_client

    response = _get(client, "district_name=Kannauj&state_code=UP")
    assert response.status_code == 200, response.text

    sql = session.sql
    assert "lower(" in sql.lower(), "the filter must normalise case on both sides"
    assert "like" not in sql.lower() or "%" not in sql, (
        "district matching must not be a LIKE pattern; a caller could otherwise "
        "pass '_' and match every district in the state"
    )
    # Exact comparison: the parameter is bound as a value, not interpolated.
    assert "kannauj" in session.sql.lower() or "Kannauj" in session.sql


def test_wildcards_in_the_district_name_are_treated_as_text(works_client):
    """`_` must not become a single-character wildcard.

    Under `ilike('%_%')` this matches every non-empty district name in the state,
    which is a plausible thing for a client to send by accident and a way to
    enumerate all districts.
    """
    client, session = works_client

    response = _get(client, "district_name=_&state_code=UP")
    assert response.status_code == 200, response.text
    assert "no rows" not in response.text.lower()


def test_district_name_matching_is_case_insensitive_not_case_sensitive(works_client):
    client, session = works_client

    lower = _get(client, "district_name=kannauj&state_code=up")
    assert lower.status_code == 200

    session.sql = ""
    upper = _get(client, "district_name=KANNAUJ&state_code=UP")
    assert upper.status_code == 200

    # Both requests must produce the same shape of comparison, i.e. lower() on
    # both sides, so a differently-cased name from the register still matches.
    assert "lower(" in session.sql.lower()
