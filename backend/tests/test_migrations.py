"""
Tests for the SQL migration runner's offline behaviour.

A live PostgreSQL is not required to check that migrations are discovered,
version-ordered, and idempotent-by-inspection. Applying them still needs a
database, which this environment does not have.

Run:  python -m pytest backend/tests -q
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

from sqlalchemy import CheckConstraint

BACKEND = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND.parent
for candidate in (str(BACKEND), str(REPO_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


def _load_runner():
    """Import run_migrations.py, whose directory name is not a valid module name."""
    path = BACKEND / "migrations" / "run_migrations.py"
    spec = importlib.util.spec_from_file_location("_run_migrations", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


runner = _load_runner()


def test_migrations_are_discovered_and_version_ordered():
    found = runner.discover()
    assert found, "no migrations found"
    names = [p.name for _v, p in found]
    assert names == sorted(names, key=lambda n: int(n.split("_")[0])), names
    assert names[0].startswith("001_")


def test_only_known_migration_files_are_present():
    for _version, path in runner.discover():
        assert re.match(r"^\d{3}_[A-Za-z0-9_]+\.sql$", path.name), path.name


def test_dsn_strips_the_asyncpg_driver_suffix():
    from config import settings

    original = settings.DATABASE_URL
    try:
        settings.DATABASE_URL = "postgresql+asyncpg://u:p@h:5432/db"
        assert runner.dsn() == "postgresql://u:p@h:5432/db"
        settings.DATABASE_URL = "postgresql://u:p@h:5432/db"
        assert runner.dsn() == "postgresql://u:p@h:5432/db"
    finally:
        settings.DATABASE_URL = original


def _migration_sql(name: str) -> str:
    return (BACKEND / "migrations" / name).read_text(encoding="utf-8")


def test_auth_migration_creates_the_pgcrypto_dependency():
    """gen_random_uuid() is built in only from PG13; earlier needs pgcrypto."""
    sql = _migration_sql("001_auth_users.sql")
    assert "gen_random_uuid()" in sql
    assert re.search(
        r"CREATE EXTENSION\s+IF NOT EXISTS\s+pgcrypto", sql, re.IGNORECASE
    ), "001 must enable pgcrypto or gen_random_uuid() fails on PG < 13"


def test_users_table_rejects_the_public_role():
    sql = _migration_sql("001_auth_users.sql")
    assert "CREATE TABLE IF NOT EXISTS users" in sql
    check = re.search(r"CHECK\s*\(role IN \(([^)]*)\)\)", sql, re.DOTALL)
    assert check, "001 must constrain users.role to known roles"
    values = {v.strip().strip("'") for v in check.group(1).split(",")}
    assert "PUBLIC" not in values
    assert values == {"CITIZEN", "MP", "AUDITOR", "DISTRICT_AUTHORITY", "ADMIN"}


def test_no_migration_creates_a_seed_account():
    """A migration that inserts a usable account would be an unaudited backdoor."""
    for _version, path in runner.discover():
        sql = path.read_text(encoding="utf-8")
        offenders = [
            m
            for m in re.findall(
                r"INSERT\s+INTO\s+users\b[^;]*", sql, re.IGNORECASE
            )
        ]
        assert not offenders, f"{path.name} inserts a user row: {offenders}"


def test_migrations_are_idempotent_by_construction():
    """Every DDL/DML statement should tolerate re-running the file.

    The runner guards against re-applying a whole file with its ledger, so this
    matters for recovery: a failed deployment that was partly applied by hand
    should still converge. Two shapes are acceptable — an explicit existence
    guard, or a predicate that matches nothing on the second run.
    """
    for _version, path in runner.discover():
        sql = path.read_text(encoding="utf-8")
        statements = [
            s.strip()
            for s in re.split(r";\s*\n", sql)
            if s.strip() and not s.strip().startswith("--")
        ]
        for statement in statements:
            upper = " ".join(statement.split()).upper()
            is_statement = upper.startswith(
                ("CREATE ", "ALTER TABLE", "DROP ", "INSERT", "UPDATE", "GRANT")
            )
            if not is_statement:
                continue
            guarded = any(
                token in upper
                for token in (
                    "IF NOT EXISTS",
                    "IF EXISTS",
                    "ON CONFLICT",
                    "ADD CONSTRAINT",  # wrapped in a pg_constraint guard below
                    # An UPDATE that only touches rows it has not already
                    # changed matches nothing on a second run.
                    "IS NULL",
                )
            )
            assert guarded, f"{path.name}: unguarded statement -> {statement[:120]}"


def test_evidence_parent_constraint_name_matches_the_orm():
    """The SQL and the ORM must declare the same constraint, under one name.

    They carried the same predicate under two names — `evidence_single_parent`
    in 003 and `ck_evidence_exactly_one_parent` in models.py. A database built
    by the migration and one built by `Base.metadata.create_all` then have two
    differently-named copies of the same check, and any future Alembic
    autogenerate emits a permanent spurious diff.
    """
    from models.models import EvidenceAttachment

    sql = _migration_sql("003_citizen_demands.sql")
    orm_names = {
        c.name for c in EvidenceAttachment.__table__.constraints if c.name
    }
    assert "ck_evidence_exactly_one_parent" in orm_names, orm_names
    assert "ck_evidence_exactly_one_parent" in sql, (
        "003 must name the check constraint exactly as the ORM does"
    )
    # The superseded name must no longer be *declared*. It is still named in
    # the RENAME CONSTRAINT guard below, which is what converges an already
    # migrated database, so only the declaration form is forbidden.
    assert not re.search(
        r"CONSTRAINT\s+evidence_single_parent\s+CHECK", sql, re.IGNORECASE
    ), "003 still declares the old constraint name"
    assert re.search(
        r"RENAME\s+CONSTRAINT\s+evidence_single_parent", sql, re.IGNORECASE
    ), (
        "003 must rename the old constraint for databases that already applied "
        "it, otherwise those schemas keep the divergent name forever"
    )


def test_evidence_parent_constraint_appears_exactly_once_in_the_orm():
    """A second, differently-named copy in the ORM is the same drift again."""
    from models.models import EvidenceAttachment

    checks = [
        c
        for c in EvidenceAttachment.__table__.constraints
        if isinstance(c, CheckConstraint)
    ]
    assert len(checks) == 1, [c.name for c in checks]


def test_widening_the_work_key_is_guarded_by_the_catalog():
    """Postgres has no IF EXISTS form for ALTER COLUMN ... TYPE.

    The widening in 002 has to read information_schema first, or a hand-run of
    the file a second time fails even though the column is already correct.
    """
    sql = _migration_sql("002_work_feed_columns.sql")
    assert "ALTER TABLE works ALTER COLUMN work_id TYPE" not in sql, (
        "002 must not contain a bare ALTER COLUMN TYPE; it is not re-runnable"
    )
    assert "information_schema.columns" in sql
    assert "DO $$" in sql
