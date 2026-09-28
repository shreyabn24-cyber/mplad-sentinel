"""
MPLADS Sentinel — Authentication, authorisation and the authenticated principal.

Why this module exists
----------------------
Until now the API had *no* server-side access control at all. Every one of the
30 `/api/v1/*` routes was reachable by an anonymous caller, including:

  * ``POST /anomalies/{work_id}/review``   — write an audit verdict
  * ``POST /admin/train-ml``               — pipeline control
  * ``POST /notifications/broadcast``      — push alerts to every connected user
  * ``POST /satellite/query-aws``          — spend external API quota
  * ``GET  /anomalies/l3/`                 — the restricted CAG/Auditor view

and ``POST /anomalies/{work_id}/review`` recorded ``actor="SYSTEM"``, so the
audit trail could not even say *who* changed a verdict.

Design
------
Roles mirror the four portal identities the frontend already models
(``frontend/lib/auth.tsx``): ``CITIZEN``, ``MP``, ``AUDITOR``,
``DISTRICT_AUTHORITY``, plus two operational roles, ``ADMIN`` (operator) and
``PUBLIC`` (anonymous read-only).

Access is split in two so that the public oversight pages keep working while
every mutating and restricted capability is closed:

  * :func:`viewer`  — accepts any valid token; if no token is supplied it
    resolves to a synthetic ``PUBLIC`` principal. Use for public read endpoints
    (works, map, MP profiles, anomaly list/summary, satellite GET).
  * :func:`require_roles` — fails closed with 401/403 when the token is absent
    or the role is not permitted. Use for **every** state-changing endpoint.

``PUBLIC`` is never accepted by :func:`require_roles`; it is deliberately not a
member of any permission set so an anonymous caller can never satisfy a write
requirement.

Passwords are hashed with PBKDF2-HMAC-SHA256 via passlib. PBKDF2 is used rather
than bcrypt on purpose: it needs no native binary, so a fresh checkout cannot
end up with an auth layer that raises on the first hash, and it has no
dependency on the ``passlib``/``bcrypt`` version pairing.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Iterable, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db

ALGORITHM = "HS256"

# PBKDF2-HMAC-SHA256 at 290 000 rounds, the OWASP-recommended work factor.
#
# The comment here used to claim 290 000 while the CryptContext was built with
# no argument, which silently took passlib's default of 29 000 — a tenth of the
# stated cost, for every hash this project has ever written. `pbkdf2_sha256` is
# named explicitly with the round count rather than left to a library default,
# so the two cannot drift apart again.
#
# Raising the count does not lock anyone out. passlib encodes the parameters
# into the hash string (`pbkdf2_sha256$290000$salt$digest`) and reads them back
# on verification, so any password hashed under the old 29 000 default still
# verifies. The cost of the old hashes is not retroactively fixed; a user who
# logs in successfully has their stored hash re-hashed at 290 000 (see
# `verify_password` and the upgrade-on-login path in the /auth/login handler).
PBKDF2_ROUNDS = 290_000
_pwd = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
    pbkdf2_sha256__rounds=PBKDF2_ROUNDS,
)


class Role(str, Enum):
    """Authorisation roles. Values are the shared contract with the frontend."""

    PUBLIC = "PUBLIC"
    CITIZEN = "CITIZEN"
    MP = "MP"
    AUDITOR = "AUDITOR"
    DISTRICT_AUTHORITY = "DISTRICT_AUTHORITY"
    ADMIN = "ADMIN"


# Role sets, named so call sites read as intent rather than string soup.
ROLES_CITIZEN = frozenset({Role.CITIZEN})
ROLES_MP = frozenset({Role.MP})
ROLES_AUDIT = frozenset({Role.AUDITOR, Role.ADMIN})
ROLES_DISTRICT = frozenset({Role.DISTRICT_AUTHORITY, Role.ADMIN})
ROLES_OFFICE = frozenset({Role.MP, Role.DISTRICT_AUTHORITY, Role.AUDITOR, Role.ADMIN})
ROLES_ADMIN = frozenset({Role.ADMIN})

# Roles that may hold government office identities. `PUBLIC` is absent by
# construction from every set above, so anonymous access can never satisfy a
# write permission.
_ROLE_VALUES = {r.value for r in Role}

# `HTTPBearer(auto_error=False)` so that a *missing* header resolves to the
# PUBLIC principal for read endpoints instead of raising before our own logic
# runs. `require_roles` still fails closed.
_bearer = HTTPBearer(auto_error=False, description="JWT access token from POST /api/v1/auth/login")


@dataclass(frozen=True)
class Principal:
    """The authenticated (or anonymous) caller for one request.

    ``user_id`` is ``None`` only for the anonymous PUBLIC principal. Anything
    that writes an audit record must use :attr:`actor`, which is never the
    literal string ``"SYSTEM"`` — that placeholder previously made it
    impossible to tell who changed an audit verdict.
    """

    user_id: Optional[str]
    username: str
    role: Role
    full_name: Optional[str] = None
    email: Optional[str] = None
    state_code: Optional[str] = None
    district_name: Optional[str] = None
    constituency_name: Optional[str] = None
    mp_id: Optional[str] = None
    is_authenticated: bool = False

    @property
    def actor(self) -> str:
        """Stable audit-trail actor string for this caller."""
        return self.username

    def may_act_in_state(self, state_code: Optional[str]) -> bool:
        """Whether a statewide office holder may act on a record in this state.

        ADMIN and AUDITOR have national scope. An MP or DISTRICT_AUTHORITY user
        is restricted to the state they were provisioned with, and a missing
        jurisdiction on the account denies by default rather than defaulting to
        "everywhere".

        An anonymous PUBLIC caller is never granted scope here. Anonymous access
        is read-only and is expressed by ``viewer``; if a write path ever reached
        this function with a PUBLIC principal, the correct answer is refusal, not
        "they may act anywhere".
        """
        if self.role is Role.PUBLIC:
            return False
        if self.role in (Role.ADMIN, Role.AUDITOR):
            return True
        if not state_code or not self.state_code:
            return False
        return state_code.upper() == self.state_code.upper()


ANONYMOUS = Principal(
    user_id=None,
    username="anonymous",
    role=Role.PUBLIC,
    is_authenticated=False,
)


# ── Password hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a plaintext password for storage in ``users.hashed_password``."""
    if not password:
        raise ValueError("password must not be empty")
    return _pwd.hash(password)


def verify_password(password: str, hashed: str | None) -> bool:
    """Constant-time check of a candidate password against a stored hash.

    Returns ``False`` instead of raising for accounts with no usable hash so a
    half-provisioned row cannot be turned into an auth bypass or a 500.
    """
    if not hashed:
        return False
    try:
        return bool(_pwd.verify(password, hashed))
    except ValueError:
        return False


def password_needs_rehash(hashed: str | None) -> bool:
    """True when a stored hash used weaker parameters than the current setting.

    Hashes written before ``PBKDF2_ROUNDS`` was pinned carry 29 000 rounds
    instead of 290 000. They still verify — passlib reads the parameters out of
    the encoded hash — but they are ten times cheaper to attack, so the caller
    should re-hash the plaintext at login time and store the stronger hash.
    """
    if not hashed:
        return False
    try:
        return _pwd.needs_update(hashed)
    except ValueError:
        # An unparseable hash that nonetheless verified is not something this
        # function can reason about. Leave it alone rather than fail the login;
        # verify_password is still the authority on whether it matched.
        return False


# ── Tokens ───────────────────────────────────────────────────────────────────

# Substrings that identify a signing key as an unfilled template rather than a
# real secret. This is a list rather than one comparison because the repository
# ships two different placeholder spellings (config.py's default and the
# value in .env), and matching only one of them left the guard silently
# ineffective: the .env placeholder was 51 characters long, so it looked like
# a plausible key and every token was signed with a value published in the repo.
_PLACEHOLDER_MARKERS = (
    "change",
    "replace",
    "your_",
    "placeholder",
    "example",
    "insecure",
    "default",
    "todo",
    "xxxx",
)


def _secret() -> str:
    """Resolve the signing key, refusing to run on a template value.

    Two independent checks, because length alone is not evidence: a template
    can be long, and a real key can be short.
    """
    key = (settings.SECRET_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "SECRET_KEY is unset. Set a random value (>=32 bytes) in the "
            "environment or backend/.env before issuing tokens."
        )

    lowered = key.lower()
    if any(marker in lowered for marker in _PLACEHOLDER_MARKERS):
        raise RuntimeError(
            "SECRET_KEY still contains template text, so it is not a secret. "
            "Generate one, for example: "
            "python -c \"import secrets; print(secrets.token_urlsafe(48))\" "
            "and put the result in the environment or backend/.env."
        )
    if len(key) < 32:
        raise RuntimeError(
            f"SECRET_KEY is only {len(key)} characters; 32 or more are required."
        )
    return key


def create_access_token(
    *,
    user_id: str,
    username: str,
    role: Role | str,
    expires_minutes: Optional[int] = None,
) -> tuple[str, datetime]:
    """Mint a signed access token. Returns ``(token, expires_at_utc)``."""
    minutes = expires_minutes if expires_minutes is not None else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=minutes)
    role_value = role.value if isinstance(role, Role) else str(role)
    claims = {
        "sub": str(user_id),
        "usr": username,
        "role": role_value,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(claims, _secret(), algorithm=ALGORITHM), expires


def decode_access_token(token: str) -> dict:
    """Decode and verify a token. Raises :class:`HTTPException` on any problem."""
    try:
        return jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ── Principal resolution ─────────────────────────────────────────────────────

async def principal_from_token(
    token: Optional[str],
    db: AsyncSession,
) -> Principal:
    """Resolve a bearer token to a :class:`Principal`.

    The role is re-read from the database rather than trusted from the token
    body, so deactivating a user or changing their role takes effect on the next
    request instead of at token expiry.

    A database failure here is a 503, not a 500: the account's status could not
    be confirmed, and the correct response to "I cannot verify whether this
    account is still active" is to refuse the request while saying why. Silently
    accepting the token's own role claim would mean a revoked account keeps
    working whenever the database is down.
    """
    if not token:
        return ANONYMOUS

    claims = decode_access_token(token)
    subject = claims.get("sub")
    if not subject:
        return ANONYMOUS

    # Imported here to avoid a module-level cycle: models imports database,
    # which imports config, and auth already depends on database.
    from models.models import User

    try:
        result = await db.execute(select(User).where(User.user_id == subject))
        user = result.scalar_one_or_none()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - any driver/connection failure
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Account status could not be verified because the database is "
                "unreachable. The request was refused rather than authorised on "
                "the strength of the token alone."
            ),
        ) from exc

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not found or deactivated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_role = (user.role or "").strip().upper()
    if raw_role not in _ROLE_VALUES:
        # An account with an unrecognised role is an operator error; refuse it
        # rather than silently downgrading it to a lower privilege.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account role {raw_role!r} is not a recognised role.",
        )
    if raw_role == Role.PUBLIC.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The PUBLIC role is reserved for anonymous read access and cannot be assigned to an account.",
        )

    return Principal(
        user_id=str(user.user_id),
        username=user.username,
        role=Role(raw_role),
        full_name=user.full_name,
        email=user.email,
        state_code=user.jurisdiction_state,
        district_name=getattr(user, "district_name", None),
        constituency_name=getattr(user, "constituency_name", None),
        mp_id=getattr(user, "mp_id", None),
        is_authenticated=True,
    )


async def current_principal(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> Principal:
    """FastAPI dependency: the caller, or the anonymous PUBLIC principal."""
    token = credentials.credentials if credentials else None
    try:
        return await principal_from_token(token, db)
    except HTTPException:
        if credentials is None:
            return ANONYMOUS
        raise


async def viewer(principal: Principal = Depends(current_principal)) -> Principal:
    """Read access for publicly-published oversight data.

    Any valid token is accepted. A request with no token is allowed through as
    ``PUBLIC`` so the public works/map/MP/anomaly pages render without a login.
    It is not sufficient for anything that writes.
    """
    return principal


def require_roles(*allowed: Iterable[Role]) -> ...:
    """Build a dependency that admits only the listed roles.

    ``PUBLIC`` is never admitted. Fails closed: no token -> 401, wrong role ->
    403. Use this on every mutating route and on restricted reads.
    """
    permitted: frozenset[Role] = frozenset(
        role for group in allowed for role in group
    )
    if Role.PUBLIC in permitted:
        raise AssertionError("PUBLIC must not be grantable via require_roles")

    names = ", ".join(sorted(r.value for r in permitted))

    async def _dependency(
        principal: Principal = Depends(current_principal),
    ) -> Principal:
        if not principal.is_authenticated:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=(
                    "Authentication required for this operation. "
                    "Obtain a token from POST /api/v1/auth/login."
                ),
                headers={"WWW-Authenticate": "Bearer"},
            )
        if principal.role not in permitted:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Role {principal.role.value} may not perform this operation. "
                    f"Required: {names}."
                ),
            )
        return principal

    _dependency.__name__ = f"require_{'_'.join(sorted(r.value.lower() for r in permitted))}"
    return _dependency


def constant_time_equals(a: str, b: str) -> bool:
    """Timing-safe string comparison (used for API keys / tokens in checks)."""
    return hmac.compare_digest(
        hashlib.sha256(a.encode("utf-8")).digest(),
        hashlib.sha256(b.encode("utf-8")).digest(),
    )


async def write_audit_log(
    db: AsyncSession,
    principal: Principal,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
) -> None:
    """Append an audit-trail row attributed to the real caller.

    The IP address is intentionally not recorded: there is no request object in
    these call sites, and inventing one would put a placeholder address in a
    compliance record. ``actor`` is the authenticated username.
    """
    from models.models import AuditLog

    db.add(
        AuditLog(
            action=action,
            actor=principal.actor,
            entity_type=entity_type,
            entity_id=entity_id,
            old_value=old_value,
            new_value=new_value,
        )
    )
