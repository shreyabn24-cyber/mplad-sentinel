"""
Geocode REAL MPLADS work locations to coordinates
=================================================
Takes ``works_real.csv`` (from ``fetch_real_works.py``) and resolves the real
village / block / city / constituency names it contains into coordinates using
OpenStreetMap data via the Photon geocoder (Komoot), with Nominatim as a
fallback provider.

Truthfulness rules
------------------
1. Coordinates are **place centroids**, not surveyed work sites. MPLADS does
   not publish work GPS. Every emitted row records its precision tier in
   ``coordinate_precision`` so the UI can never imply survey accuracy.
2. Nothing is jittered, snapped, or invented. A place that does not resolve
   gets an empty coordinate, not a guess.
3. Results from a different state than the work belongs to are rejected.
4. Lookups are cached on disk and ordered by how many works each place covers,
   so an interrupted run still yields useful coverage.

Runtime note
------------
The open feeds contain ~26k distinct place names. Free geocoders rate-limit to
roughly one request per second, so a cold full pass takes hours. The run is
therefore resumable, incremental, and intended to be run as a background job
(see ``sync_live_data.py``). Once the cache is warm, re-runs are near-instant.

Usage
-----
    python data/geocode_works.py                 # full incremental pass
    python data/geocode_works.py --limit 200     # trial (writes a sample file)
    python data/geocode_works.py --max-lookups 500
    python data/geocode_works.py --stats         # coverage report, no network
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = Path(__file__).resolve().parent
IN_PATH = DATA_DIR / "output" / "works_real.csv"
CACHE_PATH = DATA_DIR / "raw" / "geocode_cache.json"
LOCK_PATH = DATA_DIR / "raw" / "geocode.lock"
# A run killed mid-flight leaves the lock behind. Past this age no process can
# still be writing, so reclaim it rather than requiring manual cleanup.
LOCK_STALE_SECONDS = 6 * 3600

PHOTON = "https://photon.komoot.io/api/"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Ojas-MPLADS-Sentinel/1.0 (public-transparency project; bulk place geocoding)"

# Ordered most specific first. First hit wins. Keys are works_real.csv columns.
PRECISION_TIERS = [
    ("village", "village"),
    ("city", "city"),
    ("block", "block"),
    ("constituency", "constituency"),
]

# Free geocoders rate-limit. A single worker is the polite default; a small
# fixed pool is used because a cold backfill covers ~27k distinct places and
# would otherwise take many hours. Override with --workers.
MIN_INTERVAL = 1.0
DEFAULT_WORKERS = 3
_last_call = 0.0
_lock = threading.Lock()
_stats = Counter()


def _throttle() -> None:
    global _last_call
    with _lock:
        now = time.time()
        wait = MIN_INTERVAL - (now - _last_call)
        _last_call = now + max(wait, 0.0)
    if wait > 0:
        time.sleep(wait)


def _get_json(url: str, timeout: int = 25):
    _throttle()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _normalise(text: str) -> str:
    text = (text or "").strip().lower()
    text = text.replace("&", " and ").replace("-", " ")
    return re.sub(r"\s+", " ", text).strip()


# MPLADS and OSM spell several states differently.
STATE_ALIASES = {
    "andaman and nicobar islands": "andaman",
    "andaman nicobar": "andaman",
    "orissa": "odisha",
    "pondicherry": "puducherry",
    "uttaranchal": "uttarakhand",
    "nct of delhi": "delhi",
    "national capital territory of delhi": "delhi",
    "jammu kashmir": "jammu",
}


def _state_ok(candidate_state: str, display: str, work_state: str) -> bool:
    want = _normalise(work_state)
    if not want:
        return True
    want = STATE_ALIASES.get(want, want)
    for value in (candidate_state, display):
        hay = _normalise(value)
        if not hay:
            continue
        if want in hay:
            return True
        tokens = [t for t in want.split() if len(t) > 3]
        if tokens and all(t in hay for t in tokens):
            return True
    return False


def _cache_key(place: str, state: str) -> str:
    return f"{place.strip().lower()}|{state.strip().lower()}"


def _query_photon(place: str, state: str) -> dict | None:
    try:
        data = _get_json(
            PHOTON
            + "?"
            + urllib.parse.urlencode(
                {"q": f"{place}, {state}, India", "limit": 8, "lang": "en", "countrycode": "in"}
            )
        )
    except Exception as exc:
        _stats["photon_error"] += 1
        print(f"    ! photon error '{place}': {type(exc).__name__}: {exc}")
        return None

    for feat in data.get("features", []):
        props = feat.get("properties", {})
        if not _state_ok(props.get("state", ""), "", state):
            continue
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        return {"lat": str(coords[1]), "lon": str(coords[0]), "display": props.get("name", place)}
    return None


def _query_nominatim(place: str, state: str) -> dict | None:
    for q in (f"{place}, {state}, India", f"{place}, India"):
        try:
            data = _get_json(
                NOMINATIM
                + "?"
                + urllib.parse.urlencode(
                    {
                        "q": q,
                        "format": "json",
                        "limit": 5,
                        "countrycodes": "in",
                        "addressdetails": 1,
                    }
                )
            )
        except Exception as exc:
            _stats["nominatim_error"] += 1
            print(f"    ! nominatim error '{place}': {type(exc).__name__}: {exc}")
            return None
        for hit in data:
            if not _state_ok(hit.get("state", ""), hit.get("display_name", ""), state):
                continue
            return {
                "lat": hit.get("lat", ""),
                "lon": hit.get("lon", ""),
                "display": hit.get("display_name", "")[:120],
            }
    return None


def geocode(place: str, state: str, cache: dict, refresh: bool) -> dict | None:
    key = _cache_key(place, state)
    if not refresh and key in cache:
        if cache[key] is not None:
            _stats["cache_hit"] += 1
        return cache[key]

    hit = _query_photon(place, state)
    if hit:
        _stats["photon_hit"] += 1
    else:
        hit = _query_nominatim(place, state)
        if hit:
            _stats["nominatim_hit"] += 1
    if not hit:
        _stats["miss"] += 1

    cache[key] = hit
    return hit


def load_rows(path: Path) -> tuple[list[str], list[dict]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return list(reader.fieldnames or []), list(reader)


def _progress(done: int, total: int, started: float) -> None:
    rate = done / max(time.time() - started, 1e-6)
    remaining = (total - done) / max(rate, 1e-6)
    print(
        f"    {done:,}/{total:,}  {rate:.2f}/s  "
        f"hits={_stats['photon_hit'] + _stats['nominatim_hit']:,}  "
        f"miss={_stats['miss']:,}  eta={remaining / 60:.0f} min",
        flush=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Geocode real MPLADS place names to centroids.")
    ap.add_argument("--in", dest="in_path", type=Path, default=IN_PATH)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--limit", type=int, default=0, help="Trial: only N works (writes a sample file).")
    ap.add_argument("--max-lookups", type=int, default=0, help="Cap network lookups this run.")
    ap.add_argument("--refresh", action="store_true", help="Ignore cached lookups.")
    ap.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Concurrent lookups (default 3). Use 1 to be maximally polite.",
    )
    ap.add_argument("--stats", action="store_true", help="Print coverage and exit (no network).")
    ap.add_argument(
        "--no-lock",
        action="store_true",
        help="Skip the single-writer lock. Only safe if nothing else writes the file.",
    )
    args = ap.parse_args()

    if not args.in_path.exists():
        print(f"FAILED: {args.in_path} not found. Run data/fetch_real_works.py first.")
        return 1

    if args.stats:
        fieldnames, all_rows = load_rows(args.in_path)
        print_coverage(all_rows)
        return 0

    # Two concurrent writers would each hold a stale copy of the file and the
    # second write would discard the first one's coordinates, so refuse to run.
    lock_handle = None
    if not args.no_lock:
        lock_handle = acquire_lock()
        if lock_handle is None:
            print("SKIPPED: another geocoder holds the lock on this dataset.")
            print(f"  holder recorded in {LOCK_PATH}")
            print("  (pass --no-lock to override)")
            return 0

    try:
        return run(args)
    finally:
        release_lock(lock_handle)


def run(args) -> int:
    fieldnames, all_rows = load_rows(args.in_path)

    if args.limit:
        out_path = args.out or args.in_path.with_name(f"{args.in_path.stem}_geocoded_sample.csv")
        print(f"TRIAL MODE: --limit {args.limit}; output -> {out_path.name} (full file untouched).")
    else:
        out_path = args.out or args.in_path

    # How many works does each candidate place cover? Drives ordering so that an
    # interrupted run still resolves the highest-value places.
    coverage: Counter = Counter()
    state_of: dict[str, str] = {}
    tier_of: dict[str, str] = {}
    for row in all_rows:
        for field, tier in PRECISION_TIERS:
            place = (row.get(field) or "").strip()
            if place:
                key = _cache_key(place, row.get("state_name", ""))
                coverage[key] += 1
                state_of.setdefault(key, row.get("state_name", ""))
                tier_of.setdefault(key, tier)
                break

    already = sum(1 for r in all_rows if r.get("reported_lat") and r.get("coordinate_precision"))
    print(f"\nGeocoding real MPLADS work locations via OpenStreetMap (Photon, Nominatim fallback)")
    print(f"  works in file          : {len(all_rows):,}")
    print(f"  already geocoded       : {already:,}")
    print(f"  distinct places needed : {len(coverage):,}")
    print("  NOTE: output coordinates are PLACE CENTROIDS, not surveyed work sites.\n")

    cache = load_cache()
    print(f"  cache entries on disk  : {len(cache):,}\n")

    # Highest-coverage places first.
    todo = [k for k, _ in coverage.most_common() if args.refresh or k not in cache]
    if args.max_lookups:
        todo = todo[: args.max_lookups]

    print(f"  lookups queued this run: {len(todo):,}\n")

    started = time.time()

    def resolve(key: str) -> None:
        place, state = key.split("|", 1)
        # Recover original casing for a better query.
        real = state_of.get(key, state)
        geocode(place.title() if place.islower() else place, real, cache, args.refresh)

    if args.workers <= 1:
        for i, key in enumerate(todo, start=1):
            resolve(key)
            if i % 100 == 0:
                _progress(i, len(todo), started)
                save_cache(cache)
    else:
        # Small bounded pool; the throttle serialises the actual requests.
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for i, _ in enumerate(pool.map(resolve, todo), start=1):
                if i % 100 == 0:
                    _progress(i, len(todo), started)
                    save_cache(cache)

    _progress(len(todo), len(todo), started)
    save_cache(cache)

    # Apply the cache to the rows.
    resolved = unresolved = 0
    tier_counts: Counter = Counter()
    for row in all_rows:
        if row.get("reported_lat") and not args.refresh:
            resolved += 1
            continue
        hit = tier = None
        for field, tier_name in PRECISION_TIERS:
            place = (row.get(field) or "").strip()
            if not place:
                continue
            key = _cache_key(place, row.get("state_name", ""))
            hit = cache.get(key)
            if hit:
                tier = tier_name
                break
        if hit:
            row["reported_lat"] = hit["lat"]
            row["reported_lon"] = hit["lon"]
            row["coordinate_precision"] = f"{tier}_centroid"
            resolved += 1
            tier_counts[tier] += 1
        else:
            row["reported_lat"] = ""
            row["reported_lon"] = ""
            row["coordinate_precision"] = "unresolved"
            unresolved += 1

    for col in ("reported_lat", "reported_lon", "coordinate_precision"):
        if col not in fieldnames:
            fieldnames.append(col)

    with out_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(all_rows if not args.limit else all_rows[: args.limit])

    total = resolved + unresolved
    print(f"\nWrote {out_path}")
    print(f"  geocoded   : {resolved:,} / {total:,} ({resolved * 100 // max(total, 1)}%)")
    print(f"  pending    : {unresolved:,}")
    print("\n  by precision tier:")
    for tier, count in tier_counts.most_common():
        print(f"    {tier:16} {count:,}")
    print(f"\n  provider stats: {_stats}")
    print("\n  These are real place centroids from OpenStreetMap. They are NOT")
    print("  surveyed work-site GPS and must be labelled as such in the UI.")
    return 0


def print_coverage(all_rows: list[dict]) -> None:
    """Report geocoding coverage without touching the network."""
    geocoded = sum(1 for r in all_rows if r.get("reported_lat") and r.get("coordinate_precision"))
    pending = len(all_rows) - geocoded
    print(f"  works in file   : {len(all_rows):,}")
    print(f"  geocoded        : {geocoded:,}")
    print(f"  pending         : {pending:,}")
    if CACHE_PATH.exists():
        try:
            print(f"  cache entries   : {len(load_cache()):,}")
        except (json.JSONDecodeError, OSError):
            print("  cache unreadable")


def acquire_lock():
    """Claim exclusive write access to the dataset.

    ``O_CREAT | O_EXCL`` is atomic on Windows and Linux, so exactly one process
    wins even if several start at once. A lock left behind by a killed process
    is reclaimed once it is older than the timeout, since a dead run cannot
    still be writing.
    """
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age < LOCK_STALE_SECONDS:
                try:
                    holder = LOCK_PATH.read_text(encoding="utf-8").strip()
                except OSError:
                    holder = "unknown"
                print(f"  lock age {age:.0f}s  pid {holder}")
                return None
            print(f"  reclaiming lock left stale for {age:.0f}s")
            try:
                LOCK_PATH.unlink()
            except OSError:
                return None
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(str(os.getpid()))
        return LOCK_PATH
    return None


def release_lock(handle) -> None:
    if handle is None:
        return
    try:
        Path(handle).unlink()
    except OSError:
        pass


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")


def load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


if __name__ == "__main__":
    raise SystemExit(main())
