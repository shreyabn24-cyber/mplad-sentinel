#!/usr/bin/env python
"""
MPLADS Sentinel — SQL migration runner

Applies every ``backend/migrations/NNN_*.sql`` file in order, exactly once,
recording what ran in a ``schema_migrations`` table.

Usage::

    python backend/migrations/run_migrations.py            # apply everything pending
    python backend/migrations/run_migrations.py --status   # list applied/pending
    python backend/migrations/run_migrations.py --dry-run  # print, execute nothing

Why plain SQL instead of Alembic
--------------------------------
``alembic`` is declared in ``backend/requirements.txt`` but is not installed in
the environment this project is actually run from, so an Alembic-only
migration path would block every schema change. These files are ordered and
idempotent SQL, which the runner can apply with the ``asyncpg`` driver that is
always present because the API itself needs it.

Each statement is executed in its own transaction alongside the ledger insert,
so a failure leaves the ledger and the schema consistent: a partially applied
migration is never marked as done.

Connection comes from ``settings.DATABASE_URL``
(``postgresql+asyncpg://...``); the ``+asyncpg`` suffix is stripped here because
the driver is supplied explicitly.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MIGRATIONS_DIR.parent
REPO_ROOT = BACKEND_DIR.parent
for candidate in (str(BACKEND_DIR), str(REPO_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from config import settings  # noqa: E402

_FILENAME_RE = re.compile(r"^(\d+)_([A-Za-z0-9_]+)\.sql$")

LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMP NOT NULL DEFAULT now()
);
"""


def discover() -> list[tuple[int, Path]]:
    """Return (version, path) for every well-named migration, version-sorted."""
    found: list[tuple[int, Path]] = []
    for path in MIGRATIONS_DIR.glob("*.sql"):
        match = _FILENAME_RE.match(path.name)
        if not match:
            print(
                f"warning: ignoring {path.name} — expected NNN_snake_case.sql",
                file=sys.stderr,
            )
            continue
        found.append((int(match.group(1)), path))
    found.sort(key=lambda item: (item[0], item[1].name))
    return found


def dsn() -> str:
    url = settings.DATABASE_URL
    for prefix in ("postgresql+asyncpg://", "postgresql+psycopg://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    return url


async def applied_names(conn) -> set[str]:
    await conn.execute(LEDGER_DDL)
    rows = await conn.fetch("SELECT filename FROM schema_migrations")
    return {r["filename"] for r in rows}


async def run(dry_run: bool) -> int:
    try:
        import asyncpg
    except ImportError:
        print(
            "asyncpg is required to run migrations: pip install asyncpg",
            file=sys.stderr,
        )
        return 2

    migrations = discover()
    if not migrations:
        print("No migrations found.")
        return 0

    target = dsn()
    # asyncpg accepts the DSN only with a driver it was built with; make sure we
    # are not handing it a URL that still names a different driver.
    try:
        conn = await asyncpg.connect(target)
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"error: could not connect to PostgreSQL: {type(exc).__name__}: {exc}")
        print(f"       target: {target.rsplit('@', 1)[-1]}")
        return 2

    try:
        done = await applied_names(conn)
        pending = [(v, p) for v, p in migrations if p.name not in done]

        if not pending:
            print(f"All {len(migrations)} migrations are already applied.")
            return 0

        print(f"{len(pending)} migration(s) pending:")
        for version, path in pending:
            print(f"  {path.name}")

        if dry_run:
            print("\n--dry-run: nothing executed.")
            return 0

        for version, path in pending:
            sql = path.read_text(encoding="utf-8")
            # One transaction per file, covering both the DDL and the ledger
            # row, so the ledger can never claim a migration that did not apply.
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)"
                    " ON CONFLICT (filename) DO NOTHING",
                    path.name,
                )
            print(f"  applied {path.name}")

        print("Done.")
        return 0
    finally:
        await conn.close()


def status() -> int:
    async def _status() -> int:
        import asyncpg

        conn = await asyncpg.connect(dsn())
        try:
            done = await applied_names(conn)
        finally:
            await conn.close()
        migrations = discover()
        for _version, path in migrations:
            mark = "applied" if path.name in done else "PENDING"
            print(f"  [{mark:>7}] {path.name}")
        return 0

    try:
        return asyncio.run(_status())
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"error: {type(exc).__name__}: {exc}")
        return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply pending SQL migrations.")
    parser.add_argument("--status", action="store_true", help="list applied/pending only")
    parser.add_argument("--dry-run", action="store_true", help="print pending, execute nothing")
    args = parser.parse_args()

    if args.status:
        return status()
    return asyncio.run(run(args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
