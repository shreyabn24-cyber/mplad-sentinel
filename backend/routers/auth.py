"""
MPLADS Sentinel — Authentication Router

Provides the credential exchange the API previously lacked. Before this
existed there was no way to obtain a token, and every route was open; the
frontend's "login" only wrote a role string to ``localStorage``.

Two endpoints only:

  * ``POST /auth/login``    — exchange username+password for a bearer token
  * ``GET  /auth/me``       — who the current token belongs to

Passwords are never logged, never returned, and are compared in constant time
by the hashing library. Failed logins return an identical message for unknown
users and wrong passwords so the endpoint cannot be used to enumerate accounts.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    Principal,
    Role,
    create_access_token,
    current_principal,
    hash_password,
    password_needs_rehash,
    verify_password,
    write_audit_log,
)
from config import settings
from database import get_db
from models.models import User
from schemas.schemas import LoginRequest, TokenResponse, UserProfileResponse

router = APIRouter()

logger = logging.getLogger(__name__)

_GENERIC_LOGIN_FAILURE = "Incorrect username or password."


@router.get("/demo-users")
async def list_demo_users(db: AsyncSession = Depends(get_db)):
    """Expose seeded synthetic identities only in local demo mode."""
    if not settings.DEMO_MODE or settings.ENVIRONMENT.lower() != "development":
        raise HTTPException(status_code=404, detail="Demo accounts are not enabled.")
    configured = [
        {"username": "demo_citizen", "role": "CITIZEN", "label": "Demo Citizen"},
        {"username": "demo_mp", "role": "MP", "label": "Demo MP · Guntur"},
        {"username": "demo_district", "role": "DISTRICT_AUTHORITY", "label": "Demo District · Guntur"},
        {"username": "demo_auditor", "role": "AUDITOR", "label": "Demo Auditor"},
        {"username": "demo_admin", "role": "ADMIN", "label": "Demo Admin"},
    ]
    result = await db.execute(
        select(User.username, User.role, User.is_active).where(
            func.lower(User.username).in_([entry["username"] for entry in configured])
        )
    )
    seeded = {
        username.lower(): (role, active)
        for username, role, active in result.all()
    }
    return [
        entry for entry in configured
        if (entry["username"].lower() in seeded
            and seeded[entry["username"].lower()][0] == entry["role"]
            and seeded[entry["username"].lower()][1])
    ]


def _user_from_row(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        user_id=str(user.user_id),
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        state_code=user.jurisdiction_state,
        district_name=user.district_name,
        constituency_name=user.constituency_name,
        mp_id=user.mp_id,
        is_active=bool(user.is_active),
        last_login=user.last_login,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange credentials for a signed access token.

    The response deliberately carries only the token and the role. Profile
    details are available from ``GET /auth/me`` once the token is attached.
    """
    username = (payload.username or "").strip()

    # Seeded demo accounts must never remain usable if the environment is
    # switched out of local demo mode after provisioning.
    if username.lower().startswith("demo_") and (
        not settings.DEMO_MODE or settings.ENVIRONMENT.lower() != "development"
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_GENERIC_LOGIN_FAILURE,
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not username or not payload.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both username and password are required.",
        )

    result = await db.execute(
        select(User).where(func.lower(User.username) == username.lower())
    )
    user = result.scalar_one_or_none()

    # Same error for "no such user" and "wrong password": a differing message
    # would confirm which usernames exist.
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_GENERIC_LOGIN_FAILURE,
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is deactivated. Contact the system administrator.",
        )

    # The plaintext is on hand and was just verified, so this is the only moment
    # a weak legacy hash can be upgraded. Accounts provisioned while the round
    # count was left at passlib's 29 000 default are rehashed at 290 000 here.
    # A failure here is logged, not raised: refusing a valid login because a
    # background re-hash did not save would be worse than leaving the old hash.
    if password_needs_rehash(user.hashed_password):
        try:
            user.hashed_password = hash_password(payload.password)
            await db.commit()
        except SQLAlchemyError:
            await db.rollback()
            logger.warning(
                "Rehash at login failed for user_id=%s; the existing hash is unchanged.",
                getattr(user, "user_id", "?"),
            )

    role_value = (user.role or "").strip().upper()
    try:
        role = Role(role_value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account has unrecognised role {role_value!r}; refusing to issue a token.",
        ) from exc

    if role is Role.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The PUBLIC role cannot be logged into.",
        )

    now = datetime.now(timezone.utc)
    token, expires_at = create_access_token(
        user_id=str(user.user_id),
        username=user.username,
        role=role,
    )

    user.last_login = now.replace(tzinfo=None)
    await write_audit_log(
        db,
        Principal(
            user_id=str(user.user_id),
            username=user.username,
            role=role,
            is_authenticated=True,
        ),
        action="auth.login",
        entity_type="user",
        entity_id=str(user.user_id),
    )
    await db.commit()

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        role=role.value,
        expires_at=expires_at,
        expires_in_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES,
    )


@router.get("/me", response_model=UserProfileResponse)
async def read_current_user(
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
):
    """Return the profile behind the presented token.

    An anonymous caller is answered with HTTP 401 rather than a fabricated
    profile, so a client can never mistake "no token" for "logged in as
    someone".
    """
    if not principal.is_authenticated or not principal.user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No access token presented.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(User).where(User.user_id == principal.user_id)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not found or deactivated.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _user_from_row(user)
