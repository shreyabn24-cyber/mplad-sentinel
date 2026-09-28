"""
Scheduled live-data sync for the Ojas MPLADS Sentinel
=====================================================
One entry point that refreshes every layer of real data the project publishes,
in dependency order, recording a machine-readable provenance manifest each run.

Layers
------
1. MoSPI DigiGov live API   -- national / state / per-MP aggregate figures
                              (https://www.mplads.mospi.gov.in)
2. Work-level MPLADS feed   -- 60k+ real work records, ODbL
                              (github.com/vonter/india-mplads-works)
3. Place geocoding          -- real village/block centroids from OpenStreetMap
                              (Photon, Nominatim fallback)
4. Database ingestion       -- upsert into the app database

A layer that fails does not abort the run. The manifest records the outcome of
each layer so the interface can show exactly which numbers are current and
which are unavailable, instead of silently serving stale or invented values.

Usage
-----
    python data/sync_live_data.py                 # full refresh
    python data/sync_live_data.py --layers mospi  # just the live MoSPI tiles
    python data/sync_live_data.py --skip-geocode  # aggregates + works only
    python data/sync_live_data.py --ingest-only   # re-load DB from existing CSVs
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MANIFEST = HERE / "output" / "sync_manifest.json"
MANIFEST_HISTORY = HERE / "raw" / "sync_history.jsonl"

LAYERS = ["mospi", "works", "geocode", "ingest"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_step(name: str, argv: list[str], timeout: int = 7200) -> dict:
    print(f"\n{'=' * 68}\n[{name}] {' '.join(argv[1:])}\n{'=' * 68}")
    started = time.time()
    try:
        proc = subprocess.run(
            [sys.executable, *argv],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"layer": name, "status": "timeout", "seconds": round(time.time() - started, 1)}
    except Exception as exc:
        return {"layer": name, "status": "error", "error": f"{type(exc).__name__}: {exc}"}

    output = (proc.stdout or "").strip()
    if output:
        print("\n".join(output.splitlines()[-25:]))
    if proc.returncode != 0:
        print(f"  !! exit {proc.returncode}")
        tail = (proc.stderr or "").strip().splitlines()[-8:]
        for line in tail:
            print(f"     {line}")

    return {
        "layer": name,
        "status": "ok" if proc.returncode == 0 else "failed",
        "exit_code": proc.returncode,
        "seconds": round(time.time() - started, 1),
    }


def read_live_stats() -> dict:
    path = HERE / "output" / "live_national_stats.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def geocode_coverage() -> dict:
    import csv

    path = HERE / "output" / "works_real.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    done = sum(1 for r in rows if r.get("reported_lat"))
    return {"works": len(rows), "geocoded": done, "pending": len(rows) - done}


def main() -> int:
    ap = argparse.ArgumentParser(description="Refresh all real data layers.")
    ap.add_argument("--layers", default=",".join(LAYERS), help=f"Comma list from {LAYERS}.")
    ap.add_argument("--skip-geocode", action="store_true", help="Do not geocode this run.")
    ap.add_argument("--ingest-only", action="store_true", help="Only re-run the DB ingestion.")
    ap.add_argument("--max-lookups", type=int, default=2000, help="Geocode lookups per run.")
    args = ap.parse_args()

    selected = [s.strip() for s in args.layers.split(",") if s.strip()]
    unknown = [s for s in selected if s not in LAYERS]
    if unknown:
        print(f"Unknown layer(s): {unknown}. Valid: {LAYERS}")
        return 1

    started = time.time()
    print("Ojas MPLADS Sentinel - live data sync")
    print(f"  started  : {now_iso()}")
    print(f"  layers   : {selected}")

    results = []
    if args.ingest_only:
        selected = ["ingest"]

    if "mospi" in selected:
        results.append(run_step("mospi", [str(HERE / "sync_live_mospi.py")], timeout=5400))

    if "works" in selected:
        results.append(run_step("works", [str(HERE / "fetch_real_works.py"), "--no-cache"], timeout=900))

    if "geocode" in selected and not args.skip_geocode:
        results.append(
            run_step(
                "geocode",
                [str(HERE / "geocode_works.py"), "--max-lookups", str(args.max_lookups)],
                timeout=5400,
            )
        )

    if "ingest" in selected:
        results.append(run_step("ingest", [str(HERE / "ingest_real_data.py")], timeout=5400))

    manifest = {
        "generated_at": now_iso(),
        "duration_seconds": round(time.time() - started, 1),
        "layers_requested": selected,
        "layers": results,
        "national_stats": read_live_stats(),
        "geocode_coverage": geocode_coverage(),
        "data_sources": {
            "national_and_mp_aggregates": "https://www.mplads.mospi.gov.in (MoSPI DigiGov public API)",
            "work_level_records": "https://github.com/vonter/india-mplads-works (ODbL, upstream MoSPI portal)",
            "place_geocoding": "OpenStreetMap via Photon / Nominatim (place centroids, not work-site GPS)",
            "satellite_imagery_metadata": "https://earth-search.aws.element84.com/v1 (Sentinel-2 STAC)",
        },
        "fields_without_public_source": [
            "contractor_gstin",
            "release_amount",
            "expenditure_amount",
            "completion_date",
            "district assignment for a work",
            "surveyor GPS for a work (village/block centroids are used instead)",
        ],
    }

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    MANIFEST_HISTORY.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_HISTORY.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({
            "generated_at": manifest["generated_at"],
            "statuses": {r["layer"]: r["status"] for r in results},
        }) + "\n")

    print(f"\n{'=' * 68}\nSync manifest\n{'=' * 68}")
    for r in results:
        secs = r.get("seconds", 0)
        print(f"  {r['layer']:9} {r['status']:8} {secs:>8.1f}s")
    cov = manifest["geocode_coverage"]
    if cov:
        pct = cov["geocoded"] * 100 // max(cov["works"], 1)
        print(f"\n  geocoded works: {cov['geocoded']:,}/{cov['works']:,} ({pct}%)")
    print(f"  manifest: {MANIFEST}")

    failed = [r["layer"] for r in results if r["status"] != "ok"]
    if failed:
        print(f"\n  layers needing attention: {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
