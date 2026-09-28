#!/usr/bin/env python
"""
MPLADS Sentinel — user provisioning CLI

Usage (from the repository root, with the backend package importable)::

    python backend/manage_users.py list
    python backend/manage_users.py create --username auditor1 \
        --email auditor1@example.invalid --role AUDITOR \
        --password "..." [--full-name "..."] [--state AP] \
        [--district Guntur] [--constituency Guntur] [--mp-id MP-AP-011]
    python backend/manage_users.py set-password --username auditor1 --password "..."
    python backend/manage_users.py deactivate --username auditor1
    python backend/manage_users.py activate --username auditor1
    python backend/manage_users.py show --username auditor1

Why a CLI instead of a "create first user" web form
--------------------------------------------------
The first administrator must be created out-of-band. Registering the account
that is allowed to create other accounts through an unauthenticated HTTP
endpoint is the same mistake as the open admin routes this replaced: whoever
reaches the port first becomes an operator.

No account is ever created implicitly. There are no seeded demo users, and
there is deliberately no default password.

`SECRET_KEY` must be set before tokens can be issued; this command only hashes
passwords, so it works before that.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import func, select  # noqa: E402

from auth import Role, hash_password  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models.models import User  # noqa: E402


def _role_choices() -> list[str]:
    return [r.value for r in Role if r is not Role.PUBLIC]


def _read_password(value: str | None) -> str:
    if value:
        return value
    if not sys.stdin.isatty():
        raise SystemExit(
            "Refusing to read a password from a non-interactive stdin. "
            "Pass --password explicitly, or run from a terminal to be prompted."
        )
    first = getpass.getpass("password: ")
    second = getpass.getpass("confirm password: ")
    if first != second:
        raise SystemExit("Passwords did not match.")
    return first


def _validate_password(password: str) -> None:
    if len(password) < 12:
        raise SystemExit(
            "Password must be at least 12 characters. Short shared passwords are "
            "the dominant cause of account takeover on portals like this one."
        )
    if password.lower() in {"password", "changeme", "admin", "mplads", "demo1234"}:
        raise SystemExit("That password is too predictable; choose another.")


async def cmd_list() -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).order_by(User.username))
        users = result.scalars().all()
    if not users:
        print("No users provisioned.")
        return 0
    print(f"{'USERNAME':<24} {'ROLE':<20} {'STATE':<6} {'ACTIVE':<7} EMAIL")
    for u in users:
        print(
            f"{u.username:<24} {u.role or '-':<20} "
            f"{(u.jurisdiction_state or '-'):<6} {str(bool(u.is_active)):<7} {u.email}"
        )
    return 0


async def cmd_show(args: argparse.Namespace) -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(func.lower(User.username) == args.username.lower())
        )
        user = result.scalar_one_or_none()
    if user is None:
        print(f"No such user: {args.username}")
        return 1
    print(f"user_id         {user.user_id}")
    print(f"username        {user.username}")
    print(f"email           {user.email}")
    print(f"full_name       {user.full_name or '-'}")
    print(f"role            {user.role}")
    print(f"state_code      {user.jurisdiction_state or '-'}")
    print(f"district_name   {user.district_name or '-'}")
    print(f"constituency    {user.constituency_name or '-'}")
    print(f"mp_id           {user.mp_id or '-'}")
    print(f"is_active       {bool(user.is_active)}")
    print(f"last_login      {user.last_login or 'never'}")
    return 0


async def cmd_create(args: argparse.Namespace) -> int:
    role = args.role.strip().upper()
    if role not in _role_choices():
        raise SystemExit(f"--role must be one of: {', '.join(_role_choices())}")

    password = _read_password(args.password)
    _validate_password(password)

    if args.role.strip().upper() == "MP" and not args.mp_id:
        print(
            "warning: this MP account has no --mp-id, so MP-scoped views will have "
            "no constituency to resolve.",
            file=sys.stderr,
        )

    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            select(User).where(func.lower(User.username) == args.username.lower())
        )
        if existing.scalar_one_or_none() is not None:
            print(f"User {args.username} already exists. Use set-password instead.")
            return 1

        state = (args.state or "").strip().upper() or None
        if state and len(state) != 2:
            raise SystemExit("--state must be a 2-letter state/UT code, e.g. AP.")

        user = User(
            username=args.username.strip(),
            email=args.email.strip(),
            hashed_password=hash_password(password),
            full_name=args.full_name,
            role=role,
            jurisdiction_state=state,
            district_name=args.district,
            constituency_name=args.constituency,
            mp_id=args.mp_id,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        print(f"Created {user.username} with role {user.role}.")
    return 0


async def _mutate_active(args: argparse.Namespace, active: bool) -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(func.lower(User.username) == args.username.lower())
        )
        user = result.scalar_one_or_none()
        if user is None:
            print(f"No such user: {args.username}")
            return 1
        user.is_active = active
        await db.commit()
        state = "activated" if active else "deactivated (existing tokens now rejected)"
        print(f"{user.username} {state}.")
    return 0


async def cmd_deactivate(args: argparse.Namespace) -> int:
    return await _mutate_active(args, False)


async def cmd_activate(args: argparse.Namespace) -> int:
    return await _mutate_active(args, True)


async def cmd_set_password(args: argparse.Namespace) -> int:
    password = _read_password(args.password)
    _validate_password(password)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(func.lower(User.username) == args.username.lower())
        )
        user = result.scalar_one_or_none()
        if user is None:
            print(f"No such user: {args.username}")
            return 1
        user.hashed_password = hash_password(password)
        await db.commit()
        print(f"Password updated for {user.username}.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list provisioned accounts")

    create = sub.add_parser("create", help="create an account")
    create.add_argument("--username", required=True)
    create.add_argument("--email", required=True)
    create.add_argument("--role", required=True, help=f"one of: {', '.join(_role_choices())}")
    create.add_argument("--password", help="omit to be prompted")
    create.add_argument("--full-name")
    create.add_argument("--state", help="2-letter state/UT code for jurisdiction checks")
    create.add_argument("--district")
    create.add_argument("--constituency")
    create.add_argument("--mp-id")

    setpw = sub.add_parser("set-password", help="replace an account password")
    setpw.add_argument("--username", required=True)
    setpw.add_argument("--password", help="omit to be prompted")

    for name, fn in (("deactivate", cmd_deactivate), ("activate", cmd_activate)):
        p = sub.add_parser(name, help=f"{name} an account")
        p.add_argument("--username", required=True)

    show = sub.add_parser("show", help="show one account's provisioning")
    show.add_argument("--username", required=True)

    return parser


COMMANDS = {
    "list": cmd_list,
    "show": cmd_show,
    "create": cmd_create,
    "set-password": cmd_set_password,
    "deactivate": cmd_deactivate,
    "activate": cmd_activate,
}


def main() -> int:
    args = build_parser().parse_args()
    try:
        return asyncio.run(COMMANDS[args.command](args))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        print(
            "Is PostgreSQL reachable? Set DATABASE_SYNC_URL / DATABASE_URL, then run "
            "`python backend/migrations/run_migrations.py` first.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
