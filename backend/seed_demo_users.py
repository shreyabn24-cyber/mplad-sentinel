"""Create the fixed, synthetic demo accounts for a local development instance.

Enable DEMO_MODE=true and ENVIRONMENT=development, set DEMO_PASSWORD to a
private value of at least 12 characters, then run this script from the repo
root after the database migrations. Never enable this in a hosted environment.
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import func, select

from auth import hash_password
from config import settings
from database import AsyncSessionLocal
from models.models import User


DEMO_USERS = [
    ("demo_citizen", "Demo Citizen", "CITIZEN", None, None, None),
    ("demo_mp", "Demo MP", "MP", "AP", None, "Guntur"),
    ("demo_district", "Demo District Officer", "DISTRICT_AUTHORITY", "AP", "Guntur", None),
    ("demo_auditor", "Demo Auditor", "AUDITOR", None, None, None),
    ("demo_admin", "Demo Administrator", "ADMIN", None, None, None),
]


async def main() -> None:
    if not settings.DEMO_MODE or settings.ENVIRONMENT.lower() != "development":
        raise SystemExit("Refusing to seed: DEMO_MODE=true and ENVIRONMENT=development are required.")
    password = os.getenv("DEMO_PASSWORD", "")
    if len(password) < 12:
        raise SystemExit("Set DEMO_PASSWORD to a private value of at least 12 characters.")
    async with AsyncSessionLocal() as db:
        for username, name, role, state, district, constituency in DEMO_USERS:
            existing = await db.scalar(
                select(User).where(func.lower(User.username) == username.lower())
            )
            if existing:
                if existing.role != role:
                    raise SystemExit(f"Refusing to alter unexpected role for {username}.")
                existing.hashed_password = hash_password(password)
                existing.is_active = True
                continue
            db.add(User(
                username=username,
                email=f"{username}@example.invalid",
                full_name=name,
                role=role,
                jurisdiction_state=state,
                district_name=district,
                constituency_name=constituency,
                mp_id="DEMO-AP-GUNTUR" if role == "MP" else None,
                hashed_password=hash_password(password),
                is_active=True,
            ))
        await db.commit()
    print("Created or refreshed five clearly labelled local demo accounts.")


if __name__ == "__main__":
    asyncio.run(main())
