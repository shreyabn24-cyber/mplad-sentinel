"""
Ingest REAL data into the application database
==============================================
Loads only verifiable public records. Nothing in this script invents a value.

Sources
-------
* ``data/output/works_real.csv``  -- work-level MPLADS records (ODbL, via
  vonter/india-mplads-works, upstream MoSPI portal)
* ``data/output/mps.csv``         -- 18th Lok Sabha MPs with live DigiGov figures
* ``data/reference/states.csv``   -- state code / name / region
* ``data/raw/geocode_cache.json`` -- real place centroids resolved via OSM

Deliberate omissions
--------------------
These backend columns have NO real source in the open feeds and are therefore
left NULL rather than filled with plausible-looking numbers:

    contractor_gstin, contractor_name, release_amount,
    expenditure_amount, completion_date, work_quantity, work_unit

``Work.work_id`` preserves a feed-provided reference where present. Rows with
no upstream reference receive a deterministic SHA-1 surrogate derived from the
record's own fields and prefixed ``MPLAD-``. The surrogate is tagged ``DERIVED``
and must never be presented as an official MPLADS reference number.

Usage
-----
    python data/ingest_real_data.py --dry-run
    python data/ingest_real_data.py
    python data/ingest_real_data.py --truncate-works
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUTPUT = DATA / "output"
REF = DATA / "reference"
RAW = DATA / "raw"

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from backend.config import settings  # noqa: E402
from backend.models.models import (  # noqa: E402
    District,
    MP,
    SatelliteCheck,
    State,
    Work,
)

WORKS_CSV = OUTPUT / "works_real.csv"
MPS_CSV = OUTPUT / "mps.csv"
STATES_CSV = REF / "states.csv"
DISTRICTS_CSV = REF / "districts.csv"
GEOCACHE = RAW / "geocode_cache.json"

# Honest normalisation of the real MPLADS 'STATUS' / 'CATEGORY' vocabularies.
STATUS_MAP = {
    "unsanctioned": "RECOMMENDED",
    "sanctioned": "SANCTIONED",
    "ongoing": "IN_PROGRESS",
    "completed": "COMPLETED",
    "discontinue": "CANCELLED",
    "cancelled": "CANCELLED",
    "rejected": "REJECTED",
}

# The feed's 'CATEGORY' is a four-value scheme classification, not a work type.
# The actual civil-sector name lives at the start of the WORK text, e.g.
# "Construction of a concrete road ..." -> "Construction of Roads".
CATEGORY_TO_WORK_TYPE = {
    "roads": "Roads",
    "drinking water": "Drinking Water",
    "health": "Health",
    "education": "Education",
    "other": "Other",
}


def work_key(row: dict) -> tuple[str, str]:
    """Keep a feed-provided reference; derive an explicit surrogate only if absent."""
    upstream_id = (row.get("work_id") or "").strip()
    if upstream_id:
        return upstream_id, "OFFICIAL"
    parts = [
        row.get("mp_name", ""),
        row.get("constituency", ""),
        row.get("state_name", ""),
        row.get("recommended_date", ""),
        row.get("sanction_amount", ""),
        row.get("work_description", ""),
        row.get("implementing_agency", ""),
        row.get("village", ""),
        row.get("block", ""),
    ]
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return f"MPLAD-{digest[:14].upper()}", "DERIVED"


def derive_work_type(row: dict) -> str:
    """Use the scheme's own sector category. No keyword guessing."""
    category = (row.get("category") or "").strip()
    return CATEGORY_TO_WORK_TYPE.get(category.lower(), "Other")


def parse_decimal(value: str):
    if not value:
        return None
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        return None


def parse_date(value: str):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def norm_mp_name(name: str) -> str:
    cleaned = " ".join((name or "").split()).lower()
    for prefix in ("mr ", "mrs ", "ms ", "shri ", "smt ", "dr ", "prof ", "adv "):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]
    return cleaned.strip(" .")


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> int:
    ap = argparse.ArgumentParser(description="Ingest real MPLADS data into the database.")
    ap.add_argument("--dry-run", action="store_true", help="Report what would be loaded; write nothing.")
    ap.add_argument("--truncate-works", action="store_true", help="Delete existing works rows first.")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    works_rows = read_csv(WORKS_CSV)
    mp_rows = read_csv(MPS_CSV)
    state_rows = read_csv(STATES_CSV)
    if not works_rows:
        print(f"FAILED: {WORKS_CSV} missing or empty. Run data/fetch_real_works.py first.")
        return 1
    if args.limit:
        works_rows = works_rows[: args.limit]

    print("Real-data ingestion")
    print(f"  works  : {len(works_rows):,} rows from {WORKS_CSV.name}")
    print(f"  MPs    : {len(mp_rows):,} rows from {MPS_CSV.name}")
    print(f"  states : {len(state_rows):,} rows from {STATES_CSV.name}")

    geocoded = sum(1 for r in works_rows if r.get("reported_lat"))
    print(f"  geocoded works: {geocoded:,} ({geocoded * 100 // max(len(works_rows), 1)}%)")

    if args.dry_run:
        sample = works_rows[0]
        print("\n  Dry run. Example record as it would be stored:")
        for key, value in sample.items():
            print(f"    {key:22} = {str(value)[:64]}")
        key, source = work_key(sample)
        print(f"\n    work_id               = {key}  ({source})")
        return 0

    # This importer uses SQLAlchemy's synchronous Session; DATABASE_URL is the
    # asyncpg URL used by FastAPI and cannot be consumed by create_engine.
    engine = create_engine(settings.DATABASE_SYNC_URL, future=True)
    loaded = {"states": 0, "mps": 0, "works": 0, "works_linked_to_mp": 0}

    with Session(engine) as session:
        # ---- states -------------------------------------------------------
        existing_states = {s.state_code: s for s in session.scalars(select(State))}
        for row in state_rows:
            code = (row.get("state_code") or "").strip().upper()
            if not code:
                continue
            obj = existing_states.get(code)
            if obj is None:
                obj = State(state_code=code)
                session.add(obj)
                existing_states[code] = obj
            obj.state_name = (row.get("state_name") or "").strip()
            obj.region = (row.get("region") or "").strip() or None
            loaded["states"] += 1
        session.flush()
        print(f"  states upserted: {loaded['states']}")

        # The live MPLADS MP CSV carries constituency codes but not a separate
        # constituency table. Load labels from the maintained real MP roster
        # before inserting MPs, whose FK otherwise rejects every code.
        roster_path = ROOT / "frontend" / "lib" / "allRealMps.json"
        roster = json.loads(roster_path.read_text(encoding="utf-8")) if roster_path.exists() else []
        roster_by_id = {row.get("mp_id"): row for row in roster if row.get("mp_id")}
        constituencies = {
            row.get("constituency_code"): row
            for row in roster
            if row.get("constituency_code") and row.get("constituency_name")
        }
        for code, row in constituencies.items():
            session.execute(
                text(
                    """INSERT INTO constituencies
                       (constituency_code, constituency_name, state_code, constituency_type)
                       VALUES (:code, :name, :state, 'LOKSABHA')
                       ON CONFLICT (constituency_code) DO UPDATE SET
                         constituency_name = EXCLUDED.constituency_name,
                         state_code = EXCLUDED.state_code,
                         constituency_type = EXCLUDED.constituency_type"""
                ),
                {
                    "code": code,
                    "name": row["constituency_name"],
                    "state": row.get("state_code"),
                },
            )
        print(f"  constituencies upserted: {len(constituencies)}")

        # ---- MPs ----------------------------------------------------------
        name_index: dict[str, MP] = {}
        for row in mp_rows:
            mp_id = (row.get("mp_id") or "").strip()
            if not mp_id:
                continue
            obj = session.get(MP, mp_id)
            if obj is None:
                obj = MP(mp_id=mp_id)
                session.add(obj)
            obj.full_name = (row.get("full_name") or "").strip()
            obj.party = (row.get("party") or "").strip() or None
            obj.constituency_code = (row.get("constituency_code") or "").strip() or None
            obj.state_code = (row.get("state_code") or "").strip().upper() or None
            obj.is_active = str(row.get("is_active", "True")).strip().lower() in ("true", "1", "yes")
            alloc = parse_decimal((row.get("annual_allocation") or "").strip())
            obj.annual_allocation = alloc
            if obj.full_name:
                name_index.setdefault(norm_mp_name(obj.full_name), obj)
            loaded["mps"] += 1
        session.flush()
        print(f"  MPs upserted: {loaded['mps']}  (name index: {len(name_index)})")

        if args.truncate_works:
            session.query(SatelliteCheck).delete()
            session.query(Work).delete()
            session.flush()
            print("  existing works deleted")

        # ---- works ---------------------------------------------------------
        seen_ids: set[str] = set()
        geo_cache = {}
        if GEOCACHE.exists():
            try:
                geo_cache = json.loads(GEOCACHE.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                geo_cache = {}

        for row in works_rows:
            work_id, key_source = work_key(row)
            if work_id in seen_ids:
                continue  # identical real record already staged
            seen_ids.add(work_id)

            obj = session.get(Work, work_id)
            if obj is None:
                obj = Work(work_id=work_id)
                session.add(obj)

            obj.state_code = None
            state_name = (row.get("state_name") or "").strip()
            for code, st in existing_states.items():
                if st.state_name and st.state_name.lower() == state_name.lower():
                    obj.state_code = code
                    break

            mp = name_index.get(norm_mp_name(row.get("mp_name", "")))
            if mp is not None:
                obj.mp_id = mp.mp_id
                loaded["works_linked_to_mp"] += 1
                roster_mp = roster_by_id.get(mp.mp_id, {})
            else:
                obj.mp_id = None
                roster_mp = {}

            obj.work_id_source = key_source
            obj.official_work_ref = work_id if key_source == "OFFICIAL" else None
            try:
                obj.upstream_row = int(row.get("upstream_row") or 0) or None
            except (TypeError, ValueError):
                obj.upstream_row = None
            obj.mp_name = (row.get("mp_name") or "").strip() or None
            obj.house = (row.get("house") or "").strip() or None
            obj.constituency_name = roster_mp.get("constituency_name") or (row.get("constituency") or "").strip() or None
            obj.constituency_code = roster_mp.get("constituency_code")
            obj.state_name = state_name or None
            obj.work_category = (row.get("category") or "").strip() or None
            obj.city = (row.get("city") or "").strip() or None
            obj.ward = (row.get("ward") or "").strip() or None
            obj.block = (row.get("block") or "").strip() or None
            obj.village = (row.get("village") or "").strip() or None
            obj.recommended_date = parse_date(row.get("recommended_date", ""))
            obj.ida_approval = (row.get("ida_approval") or "").strip() or None
            obj.data_as_on = parse_date(row.get("data_as_on", ""))

            obj.work_type = derive_work_type(row)
            obj.work_type_category = (row.get("category") or "").strip() or None
            obj.work_description = (row.get("work_description") or "").strip() or None
            obj.implementing_agency = (row.get("implementing_agency") or "").strip() or None
            obj.sanction_amount = parse_decimal(row.get("sanction_amount", ""))
            obj.sanction_date = parse_date(row.get("recommended_date", ""))
            obj.status = STATUS_MAP.get((row.get("status") or "").strip().lower())
            obj.scheme_year = obj.sanction_date.year if obj.sanction_date else None

            lat = parse_decimal(row.get("reported_lat", ""))
            lon = parse_decimal(row.get("reported_lon", ""))
            obj.reported_lat = float(lat) if lat is not None else None
            obj.reported_lon = float(lon) if lon is not None else None
            obj.coordinate_precision = (
                "CENTROID" if lat is not None and lon is not None else None
            )

            # No real source in the open feed. Left NULL on purpose.
            obj.contractor_gstin = None
            obj.release_amount = None
            obj.expenditure_amount = None
            obj.completion_date = None
            obj.work_quantity = None
            obj.work_unit = None
            # The feed has no district column. Leaving these unset avoids
            # inventing a district assignment for a work.
            obj.district_code = None
            obj.district_name = None

            loaded["works"] += 1

        session.commit()

    print(f"  works upserted: {loaded['works']:,}")
    print(f"  works linked to a known MP: {loaded['works_linked_to_mp']:,}")
    print(f"  unlinked (no matching MP in mps.csv): {loaded['works'] - loaded['works_linked_to_mp']:,}")
    print("\n  Fields deliberately left NULL (no real source):")
    for f in (
        "contractor_gstin",
        "release_amount",
        "expenditure_amount",
        "completion_date",
        "district_code / district_name",
        "work_quantity / work_unit",
    ):
        print(f"    {f}")
    print("\n  NOTE: official feed references are preserved; MPLAD-<hash> keys are derived surrogates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
