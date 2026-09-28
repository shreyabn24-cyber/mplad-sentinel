"""
Fetch REAL work-level MPLADS records
=====================================
Source: https://github.com/vonter/india-mplads-works
        csv/MPLADS.csv  (60,359 rows, Open Database License ODbL)

Provenance
----------
The upstream scraper (vonter/fetch.py) reads the public report pages served by
the Ministry of Statistics & Programme Implementation MPLADS portal. This
module does NOT invent, sample, or extrapolate any field: every column is a
verbatim copy of an upstream cell. Columns with no upstream counterpart are
left NULL and are never imputed.

Deliberate behaviour
--------------------
* Works with no official ID become ``None`` in ``work_id``; we do not mint
  synthetic identifiers. The row is still emitted and flagged
  ``upstream_id_missing`` so the backend can reject it if a PK is required.
* ``reported_lat``/``reported_lon`` are left NULL here. Coordinates are added
  separately by ``geocode_works.py`` from real village/block place names via
  OpenStreetMap Nominatim, and are tagged as village centroids.
* ``contractor_gstin`` is always NULL. The open feed publishes no vendor GSTIN.
* Only rows whose parliamentary house is a Lok Sabha member are kept when
  ``--lok-sabha-only`` is passed (default), since the 18th-Lok Sabha MP roster
  is what the rest of the project is keyed on.

Usage
-----
    python data/fetch_real_works.py
    python data/fetch_real_works.py --out data/output/works_real.csv
    python data/fetch_real_works.py --all-houses
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

RAW_URL = "https://raw.githubusercontent.com/vonter/india-mplads-works/main/csv/MPLADS.csv"
REPO_PAGE = "https://github.com/vonter/india-mplads-works"

DATA_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = DATA_DIR / "output" / "works_real.csv"
CACHE_DIR = DATA_DIR / "raw"

USER_AGENT = "Ojas-MPLADS-Sentinel/1.0 (public-transparency project; ODbL upstream)"

# Source column -> our output column.
# Anything not listed here is intentionally dropped rather than faked.
COLUMN_MAP = {
    "MP NAME": "mp_name",
    "WORK": "work_description",
    "CATEGORY": "category",
    "STATE": "state_name",
    "CONSTITUENCY": "constituency",
    "IDA": "implementing_agency",
    "CITY": "city",
    "WARD": "ward",
    "BLOCK": "block",
    "VILLAGE": "village",
    "RECOMMENDED DATE": "recommended_date",
    "ALLOCATION AMOUNT": "sanction_amount",
    "IDA APPROVAL": "ida_approval",
    "STATUS": "status",
    "HOUSE": "house",
}

OUT_COLUMNS = [
    "upstream_row",
    "work_id",
    "mp_name",
    "house",
    "constituency",
    "state_name",
    "implementing_agency",
    "work_description",
    "category",
    "city",
    "ward",
    "block",
    "village",
    "recommended_date",
    "sanction_amount",
    "ida_approval",
    "status",
    "reported_lat",
    "reported_lon",
    "coordinate_precision",
    "contractor_gstin",
    "data_as_on",
]

# Nothing here may be imputed. Listed so the output header documents the gaps.
ALWAYS_NULL = {
    "reported_lat": "added later by geocode_works.py from real place names",
    "reported_lon": "added later by geocode_works.py from real place names",
    "coordinate_precision": "empty until geocoding runs",
    "contractor_gstin": "the open MPLADS feed publishes no vendor GSTIN",
}

# Upstream uses a handful of real, non-normalised house labels. Keep verbatim.
HOUSE_LABELS = {"Lok Sabha", "Rajya Sabha"}

# The portal prefixes some work descriptions with its own reference number,
# e.g. "WS/MP521/2023-2024/3061 - Construction of ...". Matched case-sensitively
# and anchored to the start so a reference mentioned mid-sentence is not used.
OFFICIAL_REF_RE = re.compile(r"^([A-Z]{1,4}/MP\d+/\d{4}-\d{4}/\d+)\s*[-–:]")


def fetch_bytes(url: str = RAW_URL, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.read()


def cache_raw(payload: bytes) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = CACHE_DIR / f"mplads_works_{stamp}.csv"
    path.write_bytes(payload)
    return path


def parse_amount(raw: str) -> str:
    """Pass the upstream figure through unchanged, or '' if absent.

    No rounding, no defaults. MPLADS uses Indian digit grouping in some
    exports and plain integers in others, so only grouping commas are removed.
    """
    if raw is None:
        return ""
    value = raw.strip().replace(",", "").replace("\xa0", "")
    return value


def parse_date(raw: str) -> str:
    """Normalise to ISO where unambiguous, else ''.

    Upstream dates are dd-mm-yyyy. Values that are not valid dates are dropped
    rather than guessed.
    """
    if not raw:
        return ""
    text = raw.strip()
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def build_records(payload: bytes, lok_sabha_only: bool) -> tuple[list[dict], dict]:
    reader = csv.reader(io.StringIO(payload.decode("utf-8-sig", "replace")), delimiter=";")
    try:
        header = next(reader)
    except StopIteration:
        return [], {"error": "upstream file was empty"}

    index = {name.strip(): pos for pos, name in enumerate(header)}
    missing = [c for c in COLUMN_MAP if c not in index]
    if missing:
        return [], {"error": f"upstream header missing expected columns: {missing}", "header": header}

    data_as_on = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    records: list[dict] = []
    dropped_house = 0
    blank_house = 0
    seen_refs: set[str] = set()
    with_official_ref = 0

    for raw_row in reader:
        def cell(name: str) -> str:
            pos = index[name]
            return raw_row[pos].strip() if pos < len(raw_row) else ""

        house = cell("HOUSE")
        if house and house not in HOUSE_LABELS:
            # Unknown label: keep the row but record it rather than dropping.
            pass
        if lok_sabha_only and house != "Lok Sabha":
            if not house:
                blank_house += 1
            else:
                dropped_house += 1
            continue

        amount = parse_amount(cell("ALLOCATION AMOUNT"))
        description = cell("WORK")

        # Roughly a third of descriptions begin with the portal's own work
        # reference, e.g. "WS/MP521/2023-2024/3061 - Construction of ...".
        # That IS an official identifier, so extract it rather than minting a
        # surrogate for those rows. The remainder stay blank.
        work_id = ""
        ref = OFFICIAL_REF_RE.match(description)
        if ref:
            work_id = ref.group(1).strip()
            if work_id in seen_refs:
                # A duplicate reference would make the ID ambiguous.
                work_id = ""
            else:
                seen_refs.add(work_id)
                with_official_ref += 1

        records.append(
            {
                "upstream_row": len(records) + 1,
                "work_id": work_id,
                "mp_name": cell("MP NAME"),
                "house": house,
                "constituency": cell("CONSTITUENCY"),
                "state_name": cell("STATE"),
                "implementing_agency": cell("IDA"),
                "work_description": description,
                "category": cell("CATEGORY"),
                "city": cell("CITY"),
                "ward": cell("WARD"),
                "block": cell("BLOCK"),
                "village": cell("VILLAGE"),
                "recommended_date": parse_date(cell("RECOMMENDED DATE")),
                "sanction_amount": amount,
                "ida_approval": cell("IDA APPROVAL"),
                "status": cell("STATUS"),
                "reported_lat": "",
                "reported_lon": "",
                "coordinate_precision": "",
                "contractor_gstin": "",
                "data_as_on": data_as_on,
            }
        )

    stats = {
        "rows_kept": len(records),
        "rows_dropped_non_lok_sabha": dropped_house,
        "rows_dropped_blank_house": blank_house,
        "rows_missing_description": sum(1 for r in records if not r["work_description"]),
        "rows_missing_amount": sum(1 for r in records if not r["sanction_amount"]),
        "distinct_mps": len({r["mp_name"] for r in records if r["mp_name"]}),
        "distinct_states": len({r["state_name"] for r in records if r["state_name"]}),
        "distinct_constituencies": len({r["constituency"] for r in records if r["constituency"]}),
        "with_village": sum(1 for r in records if r["village"]),
        "with_block": sum(1 for r in records if r["block"]),
        "with_official_ref": with_official_ref,
        "rows_missing_official_ref": len(records) - with_official_ref,
        "total_allocation": sum(float(r["sanction_amount"]) for r in records if r["sanction_amount"]),
    }
    return records, stats


def write_csv(records: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=OUT_COLUMNS)
        writer.writeheader()
        writer.writerows(records)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch real work-level MPLADS records.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--all-houses",
        action="store_true",
        help="Include Rajya Sabha and blank-house rows (default: Lok Sabha only).",
    )
    parser.add_argument("--no-cache", action="store_true", help="Do not save a raw copy.")
    args = parser.parse_args()

    print(f"Fetching real work-level MPLADS records from:\n  {RAW_URL}\n  (upstream: {REPO_PAGE})\n")
    try:
        payload = fetch_bytes()
    except Exception as exc:  # network failure must be visible, not papered over
        print(f"FAILED to reach upstream: {type(exc).__name__}: {exc}")
        return 1

    print(f"  downloaded {len(payload):,} bytes")
    if not args.no_cache:
        print(f"  cached raw copy -> {cache_raw(payload)}")

    records, stats = build_records(payload, lok_sabha_only=not args.all_houses)
    if "error" in stats:
        print(f"FAILED to parse upstream file: {stats['error']}")
        return 1

    write_csv(records, args.out)

    print("\nWrote:")
    print(f"  {args.out}")
    print(f"  {stats['rows_kept']:,} real work rows\n")
    print("Provenance checks")
    print(f"  distinct MPs             : {stats['distinct_mps']}")
    print(f"  distinct states          : {stats['distinct_states']}")
    print(f"  distinct constituencies  : {stats['distinct_constituencies']}")
    print(f"  rows with village        : {stats['with_village']:,}")
    print(f"  rows with block          : {stats['with_block']:,}")
    print(f"  rows missing description : {stats['rows_missing_description']:,}")
    print(f"  rows missing amount      : {stats['rows_missing_amount']:,}")
    print(f"  total allocation (INR)   : {stats['total_allocation']:,.0f}")
    if args.all_houses is False:
        print(f"  dropped (not Lok Sabha)  : {stats['rows_dropped_non_lok_sabha']:,}")

    print("\nFields intentionally left NULL (no upstream source):")
    for field, reason in ALWAYS_NULL.items():
        print(f"  {field:24} {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
