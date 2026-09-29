"""
Tests for the authentication and authorisation layer.

These run without PostgreSQL. Everything here either exercises pure functions
(hashing, tokens, role logic) or overrides the database dependency, because the
point being tested is the access decision, not the query.

Run:  python -m pytest backend/tests -q
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND.parent
for candidate in (str(BACKEND), str(REPO_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import secrets as _secrets  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from config import settings  # noqa: E402

# The repository ships a template SECRET_KEY in .env, and the signing guard
# rightly refuses it. Tests that exercise token issuance need a real one, so
# install a generated value before the application module is imported. This is
# a test-only override; nothing here changes the deployment's configuration.
settings.SECRET_KEY = _secrets.token_urlsafe(48)

import main as app_module  # noqa: E402
from auth import (  # noqa: E402
    ANONYMOUS,
    Principal,
    Role,
    ROLES_ADMIN,
    ROLES_AUDIT,
    ROLES_CITIZEN,
    create_access_token,
    current_principal,
    decode_access_token,
    hash_password,
    PBKDF2_ROUNDS,
    password_needs_rehash,
    require_roles,
    verify_password,
)
from database import get_db  # noqa: E402


# ── Password hashing ─────────────────────────────────────────────────────────

def test_hash_is_salted_so_equal_passwords_differ():
    a = hash_password("correct horse battery staple")
    b = hash_password("correct horse battery staple")
    assert a != b, "two hashes of the same password must differ (no fixed salt)"
    assert verify_password("correct horse battery staple", a)
    assert verify_password("correct horse battery staple", b)


def test_verify_rejects_wrong_password():
    hashed = hash_password("s3cret-value-here")
    assert not verify_password("s3cret-value-her3", hashed)
    assert not verify_password("", hashed)


@pytest.mark.parametrize("stored", [None, "", "not-a-valid-hash"])
def test_verify_returns_false_for_unusable_stored_hash(stored):
    """A half-provisioned account must fail closed, not raise a 500 or pass."""
    assert verify_password("anything", stored) is False


def test_plaintext_never_appears_in_hash():
    hashed = hash_password("my-unique-passphrase")
    assert "my-unique-passphrase" not in hashed


def test_new_hashes_use_the_pinned_work_factor():
    """Not a default this time.

    The CryptContext was built with no arguments while its comment claimed
    290 000 rounds, so every hash was written at passlib's 29 000 default — a
    tenth of the stated cost. If the round count is dropped from the
    CryptContext again, this fails.
    """
    hashed = hash_password("work-factor-probe")
    # passlib writes the scheme with a hyphen in the encoded form.
    assert f"pbkdf2-sha256${PBKDF2_ROUNDS}$" in hashed


def test_password_needs_rehash_is_false_for_a_current_hash():
    assert password_needs_rehash(hash_password("already-strong")) is False


def test_a_legacy_29k_hash_still_verifies_and_is_flagged_for_upgrade():
    """The old hashes must keep working.

    Accounts provisioned before the round count was pinned carry 29 000 rounds.
    passlib reads the parameters out of the encoded hash, so they still verify —
    pinning the new count must not lock anyone out of the deployment.
    """
    from passlib.context import CryptContext

    legacy = CryptContext(
        schemes=["pbkdf2_sha256"],
        deprecated="auto",
        pbkdf2_sha256__rounds=29_000,
    ).hash("pre-existing-password")

    assert verify_password("pre-existing-password", legacy)
    assert password_needs_rehash(legacy) is True


def test_rehash_needed_is_false_when_there_is_no_hash_to_rehash():
    assert password_needs_rehash(None) is False
    assert password_needs_rehash("") is False
    # An unparseable value must not raise here; verify_password is the
    # authority on whether it matched.
    assert password_needs_rehash("not-a-valid-hash") is False


# ── Tokens ───────────────────────────────────────────────────────────────────

def test_token_round_trip_preserves_identity():
    token, expires = create_access_token(
        user_id="11111111-1111-1111-1111-111111111111",
        username="auditor.one",
        role=Role.AUDITOR,
    )
    claims = decode_access_token(token)
    assert claims["sub"] == "11111111-1111-1111-1111-111111111111"
    assert claims["usr"] == "auditor.one"
    assert claims["role"] == "AUDITOR"
    assert expires.timestamp() > time.time()


def test_tampered_token_is_rejected():
    from fastapi import HTTPException

    token, _ = create_access_token(
        user_id="22222222-2222-2222-2222-222222222222",
        username="someone",
        role=Role.ADMIN,
    )
    # Flip one character of the signature segment.
    head, _, signature = token.rpartition(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
    with pytest.raises(HTTPException) as excinfo:
        decode_access_token(f"{head}.{flipped}")
    assert excinfo.value.status_code == 401


def test_token_signed_with_a_different_key_is_rejected():
    """A token minted with a stale/attacker key must not verify here."""
    from fastapi import HTTPException
    from jose import jwt

    forged = jwt.encode(
        {"sub": "33333333-3333-3333-3333-333333333333", "role": "ADMIN"},
        "a-different-secret-entirely-32-bytes!!",
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as excinfo:
        decode_access_token(forged)
    assert excinfo.value.status_code == 401


def test_expired_token_is_rejected():
    from fastapi import HTTPException

    token, _ = create_access_token(
        user_id="44444444-4444-4444-4444-444444444444",
        username="someone",
        role=Role.CITIZEN,
        expires_minutes=-1,
    )
    with pytest.raises(HTTPException) as excinfo:
        decode_access_token(token)
    assert excinfo.value.status_code == 401


@pytest.mark.parametrize(
    "placeholder",
    [
        "change-this-in-production",
        "your_super_secret_jwt_key_change_this_in_production",
        "your-secret-key-here",
        "please-change-me",
        "CHANGE_THIS",
        "secret",
        "",
    ],
)
def test_signing_refuses_a_template_secret(monkeypatch, placeholder):
    """A template value must never produce a usable token.

    The repository ships two spellings of the placeholder — config.py's default
    and the one in .env. The second is 51 characters long, so a length check
    alone accepts it, and a guard that only matched the first spelling left the
    deployment signing real tokens with a value published in the repo.
    """
    monkeypatch.setattr(settings, "SECRET_KEY", placeholder)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_access_token(
            user_id="55555555-5555-5555-5555-555555555555",
            username="x",
            role=Role.ADMIN,
        )


def test_signing_refuses_a_short_secret(monkeypatch):
    """A real but too-short key is still refused; length is a floor, not a goal."""
    monkeypatch.setattr(settings, "SECRET_KEY", "a4f9c1b7e2d8035a")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_access_token(
            user_id="55555555-5555-5555-5555-555555555555",
            username="x",
            role=Role.ADMIN,
        )


def test_signing_accepts_a_generated_secret(monkeypatch):
    import secrets as secrets_module

    monkeypatch.setattr(
        settings, "SECRET_KEY", secrets_module.token_urlsafe(48)
    )
    token, expires = create_access_token(
        user_id="55555555-5555-5555-5555-555555555555",
        username="x",
        role=Role.ADMIN,
    )
    assert token and expires.timestamp() > time.time()


# ── Role sets ────────────────────────────────────────────────────────────────

def test_public_is_never_a_grantable_role():
    for role_set in (ROLES_ADMIN, ROLES_AUDIT, ROLES_CITIZEN):
        assert Role.PUBLIC not in role_set
    with pytest.raises(AssertionError):
        require_roles({Role.PUBLIC})


def test_anonymous_principal_cannot_act_in_any_state():
    assert ANONYMOUS.role is Role.PUBLIC
    assert ANONYMOUS.is_authenticated is False
    assert not ANONYMOUS.may_act_in_state("AP")


def test_state_scoping():
    mp = Principal(
        user_id="1", username="mp", role=Role.MP, state_code="AP", is_authenticated=True
    )
    assert mp.may_act_in_state("AP")
    assert mp.may_act_in_state("ap"), "comparison must be case-insensitive"
    assert not mp.may_act_in_state("UP")
    assert not mp.may_act_in_state(None), "an unknown record state must deny"

    unprovisioned = Principal(user_id="2", username="mp2", role=Role.MP, is_authenticated=True)
    assert not unprovisioned.may_act_in_state("AP"), (
        "an MP account with no state provisioned must not default to national scope"
    )

    auditor = Principal(user_id="3", username="aud", role=Role.AUDITOR, is_authenticated=True)
    assert auditor.may_act_in_state("UP"), "auditors have national scope"


def test_actor_is_the_real_username_not_system():
    p = Principal(user_id="9", username="auditor.sharma", role=Role.AUDITOR, is_authenticated=True)
    assert p.actor == "auditor.sharma"
    assert p.actor != "SYSTEM"


# ── The require_roles dependency, exercised through real HTTP calls ──────────

def _token_for(role: Role, username: str = "tester") -> str:
    token, _ = create_access_token(
        user_id="66666666-6666-6666-6666-666666666666",
        username=username,
        role=role,
    )
    return token


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app, raise_server_exceptions=False)


class _StubResult:
    def __init__(self, user):
        self._user = user

    def scalar_one_or_none(self):
        return self._user


class _StubSession:
    """Minimal stand-in for AsyncSession that answers the account lookup.

    Lets the tests exercise the real token -> database -> role decision chain
    without a live PostgreSQL instance, including the deactivation path. It
    holds exactly one account and returns it for any lookup.
    """

    def __init__(self):
        self.account = None
        self.audit_entries = []
        self.committed = False

    async def execute(self, _statement):
        return _StubResult(self.account)

    def add(self, obj):
        # Session.add is synchronous in SQLAlchemy 2.x; only commit/flush are
        # awaitable. Keeping this sync catches the same mistake in the stub
        # that would otherwise appear in the auth code.
        self.audit_entries.append(obj)

    async def commit(self):
        self.committed = True

    async def flush(self):
        return None


def _make_user(**overrides):
    import uuid

    from models.models import User

    defaults = {
        "user_id": uuid.UUID("66666666-6666-6666-6666-666666666666"),
        "username": "test.user",
        "email": "test.user@example.invalid",
        "hashed_password": hash_password("not-used-in-this-path"),
        "full_name": "Test User",
        "role": "CITIZEN",
        "is_active": True,
    }
    defaults.update(overrides)
    return User(**defaults)


@pytest.fixture
def stubbed_client():
    """A client whose database dependency is replaced by an in-memory stub.

    Yields ``(client, session)``; assign ``session.account`` to control which
    account the auth lookup resolves.
    """
    session = _StubSession()

    def _override_get_db():
        yield session

    app_module.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app_module.app, raise_server_exceptions=False), session
    finally:
        app_module.app.dependency_overrides.pop(get_db, None)


def test_citizen_token_cannot_reach_admin(stubbed_client):
    client, session = stubbed_client
    session.account = _make_user(role="CITIZEN", username="citizen.one")

    response = client.post(
        "/api/v1/admin/train-ml",
        json={},
        headers={"Authorization": f"Bearer {_token_for(Role.CITIZEN)}"},
    )
    assert response.status_code == 403, response.text
    detail = response.json()["detail"]
    assert "CITIZEN" in detail and "may not perform" in detail


def test_citizen_token_cannot_reach_the_auditor_l3_view(stubbed_client):
    client, session = stubbed_client
    session.account = _make_user(role="CITIZEN", username="citizen.one")

    response = client.get(
        "/api/v1/anomalies/l3/",
        headers={"Authorization": f"Bearer {_token_for(Role.CITIZEN)}"},
    )
    assert response.status_code == 403


def test_role_change_takes_effect_on_the_next_request_without_relogin(stubbed_client):
    """The database role, not the token body, is authoritative."""
    client, session = stubbed_client
    session.account = _make_user(role="AUDITOR", username="promoted")
    token = _token_for(Role.AUDITOR, username="promoted")

    allowed = client.get(
        "/api/v1/anomalies/l3/", headers={"Authorization": f"Bearer {token}"}
    )
    assert allowed.status_code in (200, 503, 500), allowed.status_code
    assert "may not perform" not in allowed.text

    session.account = _make_user(role="CITIZEN", username="promoted")
    revoked = client.get(
        "/api/v1/anomalies/l3/", headers={"Authorization": f"Bearer {token}"}
    )
    assert revoked.status_code == 403
    assert "CITIZEN" in revoked.json()["detail"]


def test_deactivated_account_is_refused_even_with_a_valid_token(stubbed_client):
    client, session = stubbed_client
    session.account = _make_user(role="ADMIN", username="gone", is_active=False)

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_token_for(Role.ADMIN)}"},
    )
    assert response.status_code == 401
    assert "deactivated" in response.json()["detail"].lower()


def test_account_claiming_the_public_role_is_refused(stubbed_client):
    """PUBLIC is the anonymous read class and must never be assignable."""
    client, session = stubbed_client
    session.account = _make_user(role="PUBLIC", username="sneaky")

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_token_for(Role.ADMIN)}"},
    )
    assert response.status_code == 403
    assert "PUBLIC" in response.json()["detail"]


def test_login_with_a_wrong_password_yields_no_token(stubbed_client):
    client, session = stubbed_client
    session.account = _make_user(role="AUDITOR", username="auditor.one")

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "auditor.one", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert "access_token" not in response.json()
    # One generic message for both unknown users and bad passwords, so the
    # response cannot be used to enumerate valid usernames.
    assert "incorrect username or password" in response.json()["detail"].lower()


def test_unknown_username_is_indistinguishable_from_a_wrong_password(stubbed_client):
    client, session = stubbed_client
    session.account = _make_user(role="AUDITOR", username="auditor.one")

    known = client.post(
        "/api/v1/auth/login",
        json={"username": "auditor.one", "password": "wrong-password"},
    )
    unknown = client.post(
        "/api/v1/auth/login",
        json={"username": "no.such.account", "password": "wrong-password"},
    )
    assert known.status_code == unknown.status_code == 401
    assert known.json()["detail"] == unknown.json()["detail"]


def test_successful_login_returns_a_token_and_writes_an_audit_row(stubbed_client):
    client, session = stubbed_client
    password = "a-real-password-for-this-test"
    session.account = _make_user(
        role="AUDITOR",
        username="auditor.one",
        hashed_password=hash_password(password),
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "auditor.one", "password": password},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"]
    assert body["token_type"].lower() == "bearer"
    assert body["role"] == "AUDITOR"
    assert body["expires_in_minutes"] > 0
    assert body["expires_at"]

    from models.models import AuditLog

    entries = [e for e in session.audit_entries if isinstance(e, AuditLog)]
    assert entries, "a successful login must leave an audit trail"
    assert "auth.login" in [e.action for e in entries]
    # The actor must be the real account, not a placeholder such as SYSTEM.
    assert "auditor.one" in [e.actor for e in entries]


def test_health_is_open(client):
    assert client.get("/health").status_code == 200


def test_whoami_reports_anonymous_rather_than_inventing_a_user(client):
    body = client.get("/api/v1/auth/whoami").json()
    assert body["authenticated"] is False
    assert body["role"] == "PUBLIC"
    assert body["username"] is None


def test_me_rejects_anonymous_caller(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "access token" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/v1/notifications/broadcast"),
        ("post", "/api/v1/anomalies/MPLAD-TEST/review"),
        ("post", "/api/v1/admin/train-ml"),
        ("post", "/api/v1/admin/trigger-pipeline"),
        ("post", "/api/v1/admin/sync-mospi"),
        ("post", "/api/v1/admin/run-cross-scheme"),
        ("post", "/api/v1/satellite/query-aws"),
        ("post", "/api/v1/satellite/trigger-check"),
        ("post", "/api/v1/citizen/report"),
        ("post", "/api/v1/citizen/demands"),
        ("get", "/api/v1/works/MPLAD-TEST/audit-note"),
        ("get", "/api/v1/anomalies/l3/"),
        ("get", "/api/v1/contractors/"),
        ("get", "/api/v1/citizen/report/00000000-0000-0000-0000-000000000000/evidence"),
    ],
)
def test_state_changing_endpoints_reject_anonymous_callers(client, method, path):
    """No write, and no restricted read, may succeed without a token."""
    if method == "get":
        response = client.get(path)
    else:
        response = client.post(path, json={})
    assert response.status_code == 401, f"{method.upper()} {path} returned {response.status_code}"
    assert "Authentication required" in response.json()["detail"]


def test_citizen_reports_and_evidence_download_are_not_public(client):
    """A citizen's report carries a named account, coordinates, and comments.

    These are not automatically public, so the listing routes and the byte
    download must all refuse an anonymous caller.
    """
    for path in (
        "/api/v1/citizen/reports",
        "/api/v1/citizen/reports/MPLAD-TEST",
        "/api/v1/citizen/report/00000000-0000-0000-0000-000000000000/evidence",
        "/api/v1/citizen/evidence/00000000-0000-0000-0000-000000000000/download",
    ):
        response = client.get(path)
        assert response.status_code == 401, f"{path} returned {response.status_code}"


def test_demo_data_loader_is_gone(client):
    """The synthetic loader must not merely be protected — it must be removed."""
    response = client.post("/api/v1/admin/load-demo-data", json={})
    assert response.status_code in (404, 405), response.status_code


def test_garbage_token_is_rejected(client):
    response = client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not.a.real.token"}
    )
    assert response.status_code == 401


def test_notification_stream_rejects_a_query_string_token(client):
    """Documented trade-off: the token query parameter is not honoured."""
    response = client.get("/api/v1/notifications/stream?token=abc")
    assert response.status_code == 401


# ── Notification delivery scoping ────────────────────────────────────────────

def test_notification_recipients_normalise_and_drop_invalid_targets():
    from schemas.schemas import NotificationMessage

    msg = NotificationMessage(
        category="TEST", title="t", description="d", target_roles=["mp", " AUDITOR ", "public", "all"]
    )
    # PUBLIC/ALL are not addressable roles; a scoped event names real roles only.
    assert msg.recipients() == {"MP", "AUDITOR"}
    assert not msg.is_broadcast()


def test_notification_with_no_named_audience_is_a_broadcast():
    from schemas.schemas import NotificationMessage

    msg = NotificationMessage(category="TEST", title="t", description="d")
    assert msg.recipients() == set()
    assert msg.is_broadcast()


def test_notification_severity_is_constrained():
    from pydantic import ValidationError

    from schemas.schemas import NotificationMessage

    with pytest.raises(ValidationError):
        NotificationMessage(
            category="TEST", title="t", description="d", severity="TOTAL_CERTAINTY"
        )


def test_broadcast_only_reaches_subscribers_with_a_matching_role():
    import asyncio

    from routers.notifications import Subscriber, broadcast_notification, subscribers
    from schemas.schemas import NotificationMessage

    async def scenario():
        auditor = Subscriber(Principal(
            user_id="auditor-id", username="auditor.one", role=Role.AUDITOR,
            is_authenticated=True,
        ))
        citizen = Subscriber(Principal(
            user_id="citizen-id", username="citizen.one", role=Role.CITIZEN,
            is_authenticated=True,
        ))
        anon = Subscriber(ANONYMOUS)
        subscribers.update({auditor, citizen, anon})
        try:
            delivered = await broadcast_notification(
                NotificationMessage(
                    category="AUDIT",
                    title="A verdict was recorded",
                    description="x",
                    target_id="MPLAD-1",
                    target_roles=["AUDITOR"],
                )
            )
            assert delivered == 1, "an auditor-only event must not reach other roles"
            assert auditor.queue.qsize() == 1
            assert citizen.queue.qsize() == 0
            assert anon.queue.qsize() == 0
        finally:
            subscribers.discard(auditor)
            subscribers.discard(citizen)
            subscribers.discard(anon)

    asyncio.run(scenario())
