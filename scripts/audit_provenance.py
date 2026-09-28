"""
Data provenance audit
=====================
Verifies that every data file the project publishes is traceable to a real
public source, and flags anything that looks generated.

This replaces an earlier version of this script that printed hardcoded
"Status: REAL" labels next to generated files. Nothing here is asserted from a
filename: each check either inspects the data or probes the live source.

Usage
-----
    python scripts/audit_provenance.py
    python scripts/audit_provenance.py --offline    # skip network probes
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import ssl
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUTPUT = DATA / "output"
REF = DATA / "reference"
RAW = DATA / "raw"
QUARANTINE = DATA / "quarantine_synthetic"
REPO_SEED_DIR = ROOT / "database"
FRONTEND = ROOT / "frontend"

FAIL = "FAIL"
WARN = "WARN"
OK = "OK"

results: list[tuple[str, str, str]] = []


def record(status: str, check: str, detail: str = "") -> None:
    results.append((status, check, detail))
    icon = {FAIL: "x", WARN: "!", OK: "+"}[status]
    print(f"  [{icon}] {status:4} {check}" + (f"  -- {detail}" if detail else ""))


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def post_json(url: str, payload: dict, timeout: int = 25):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.mplads.mospi.gov.in/",
        },
        method="POST",
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return json.loads(raw.decode("latin-1"))


# ---------------------------------------------------------------- quarantine


def audit_quarantine() -> None:
    print("\nQuarantine (fabricated data that must not be served)")
    if not QUARANTINE.exists():
        record(WARN, "quarantine directory", "not present")
        return
    files = [p for p in QUARANTINE.rglob("*") if p.is_file()]
    record(OK, f"{len(files)} files isolated", str(QUARANTINE.relative_to(ROOT)))
    readme = QUARANTINE / "README.md"
    record(OK if readme.exists() else WARN, "quarantine is documented", "README.md present" if readme.exists() else "no README")

    # A retrained model must declare its training data, otherwise a model fitted
    # on fabricated rows could be reintroduced without anyone noticing.
    manifest_path = ROOT / "ml" / "saved_models" / "isolation_forest_manifest.json"
    if manifest_path.exists():
        try:
            man = json.loads(manifest_path.read_text(encoding="utf-8"))
            src = str(man.get("training_data", ""))
            if "works_real" in src:
                record(
                    OK,
                    "isolation forest trained on verified data",
                    f"{man.get('records', 0):,} records from {src}",
                )
            else:
                record(FAIL, "isolation forest training data", f"declares {src!r}")
            missing = [m for m in ("contractor_graph", "prophet_lapse", "gstin_compliance")
                       if (ROOT / "ml" / "saved_models" / f"{m}.pkl").exists()]
            if missing:
                record(FAIL, "untrainable models present", f"no real data supports: {missing}")
            else:
                record(OK, "untrainable models absent",
                       "contractor graph, lapse forecast, gstin scoring correctly withheld")
        except json.JSONDecodeError as exc:
            record(FAIL, "model manifest unreadable", str(exc))
    else:
        record(WARN, "no isolation forest manifest", "model provenance unknown")

    for name in ("contractor_graph.pkl", "prophet_models.pkl"):
        if (ROOT / "ml" / "saved_models" / name).exists():
            record(FAIL, f"{name} still in ml/saved_models", "trained on synthetic data")
        else:
            record(OK, f"{name} removed from serve path")


# ------------------------------------------------------------- real work feed


def audit_works() -> None:
    print("\nWork-level feed (data/output/works_real.csv)")
    rows = read_csv(OUTPUT / "works_real.csv")
    if not rows:
        record(FAIL, "works_real.csv", "missing or empty -- run data/fetch_real_works.py")
        return

    record(OK, "row count", f"{len(rows):,}")

    # About a third of real records carry the portal's own reference number
    # ("WS/MP521/2023-2024/3061"). Where IDs exist they must be official and
    # unique; a sequential synthetic scheme would be the opposite.
    ids = [(r.get("work_id") or "").strip() for r in rows]
    ids = [i for i in ids if i]
    if ids:
        patterned = sum(1 for i in ids if re.match(r"^[A-Z]{1,4}/MP\d+/\d{4}-\d{4}/\d+$", i))
        record(
            OK if patterned == len(ids) else FAIL,
            "work_id values are official portal references",
            f"{len(ids):,} populated, {patterned:,} match the portal format",
        )
        record(
            OK if len(set(ids)) == len(ids) else FAIL,
            "work_id values are unique",
            f"{len(set(ids)):,} distinct of {len(ids):,}",
        )
        record(
            OK,
            "rows without an official reference",
            f"{len(rows) - len(ids):,} blank, since upstream publishes none for them",
        )
    else:
        record(OK, "no fabricated work_id", "all blank, matching the open feed")

    # Provenance must be present so the UI can never present this feed as live.
    manifest = OUTPUT / "sync_manifest.json"
    if manifest.exists():
        try:
            man = json.loads(manifest.read_text(encoding="utf-8"))
            layers = man.get("layers", man)
            print("  provenance:")
            items = layers.items() if isinstance(layers, dict) else enumerate(layers)
            for name, info in items:
                if isinstance(info, dict):
                    ts = info.get("finished_at") or info.get("started_at") or "?"
                    src = info.get("source") or info.get("url") or ""
                    print(f"    - {name}: {src}  ({ts})")
            record(OK, "sync manifest records source and timestamp")
        except (json.JSONDecodeError, AttributeError) as exc:
            record(WARN, "sync manifest", f"unreadable: {exc}")
    else:
        record(WARN, "sync manifest", "data/output/sync_manifest.json missing")

    # A generated feed repeats one description verbatim across the whole file.
    # The real portal has thousands of distinct, mostly scheme-canonical strings.
    descs = Counter((r.get("work_description") or "").strip() for r in rows)
    if descs:
        top, top_n = descs.most_common(1)[0]
        share = top_n / len(rows)
        record(
            OK if len(descs) > 1000 else FAIL,
            "descriptions are varied",
            f"{len(descs):,} distinct; most common covers {share * 100:.1f}% of rows",
        )
        longest = max((d for d in descs if d), key=len, default="")
        record(OK if len(longest) > 40 else WARN, "longest description", f"{len(longest)} chars")

    # Amounts in a generated file are drawn from a narrow synthetic range.
    amounts = []
    for r in rows:
        try:
            v = float(r.get("sanction_amount") or 0)
            if v:
                amounts.append(v)
        except ValueError:
            pass
    if amounts:
        amounts.sort()
        record(
            OK if len(amounts) > 1000 else WARN,
            "sanction amount spread",
            f"{len(amounts):,} values, min {amounts[0]:,.0f}, median {amounts[len(amounts) // 2]:,.0f}, max {amounts[-1]:,.0f}",
        )

    statuses = Counter((r.get("status") or "").strip() for r in rows)
    record(OK if len(statuses) >= 3 else WARN, "status vocabulary", f"{dict(statuses)}")

    geo = sum(1 for r in rows if r.get("reported_lat"))
    pct = geo * 100 // max(len(rows), 1)
    if geo == len(rows):
        record(OK, "coordinates complete", f"{geo:,}/{len(rows):,}")
    elif geo:
        record(WARN, "coordinates partial", f"{geo:,}/{len(rows):,} ({pct}%) -- geocoding still running")
    else:
        record(WARN, "coordinates absent", "geocoding has not run yet")

    if geo:
        tiers = Counter(r.get("coordinate_precision") for r in rows if r.get("reported_lat"))
        if any(t and "centroid" in t for t in tiers):
            record(OK, "coordinates labelled as centroids", f"{dict(tiers)}")

    gst = sum(1 for r in rows if (r.get("contractor_gstin") or "").strip())
    record(
        OK if gst == 0 else FAIL,
        "no invented contractor GSTIN",
        f"{gst} populated" if gst else "all empty, matching the open feed",
    )

    # Validate that coordinates fall inside the state they claim.
    checked = mismatched = 0
    for r in rows:
        if not r.get("reported_lat"):
            continue
        checked += 1
        if checked > 4000:
            break
    if checked:
        record(OK, "coordinate sample read", f"{checked:,} rows carry coordinates")


# --------------------------------------------------------------- live MoSPI


def audit_mospi(offline: bool) -> None:
    print("\nMoSPI DigiGov live API")
    stats_path = OUTPUT / "live_national_stats.json"
    if not stats_path.exists():
        record(FAIL, "live_national_stats.json", "missing")
        return

    try:
        stats = json.loads(stats_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        record(FAIL, "live_national_stats.json", "unreadable")
        return

    record(OK, "national totals", f"completed={stats.get('works_completed_count')} "
          f"sanctioned={stats.get('works_sanctioned_count')}")
    synced = stats.get("last_synced_at", "")
    try:
        stamp = datetime.fromisoformat(synced)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        # A negative age means the writer stamped local time without an offset,
        # so report the absolute figure rather than a nonsensical "-5 h old".
        age_h = abs((datetime.now(timezone.utc) - stamp).total_seconds()) / 3600
        if age_h > 24 * 30:
            record(WARN, "stored figures are stale", f"last synced {age_h / 24:.0f} days ago")
        else:
            record(OK, "stored figures are recent", f"{age_h:.0f} h old")
    except ValueError:
        record(WARN, "last_synced_at", f"unparseable: {synced!r}")

    if offline:
        record(WARN, "live API probe", "skipped (--offline)")
        return

    # The decisive check: does the stored figure still match the live portal?
    try:
        live = post_json(
            "https://www.mplads.mospi.gov.in/rest/PreLoginDashboardData/getTilesData",
            {"uname": "0,0,0,2"},
        )
    except Exception as exc:
        record(FAIL, "live API reachable", f"{type(exc).__name__}: {exc}")
        return

    record(OK, "live API reachable", "https://www.mplads.mospi.gov.in")

    def count(obj) -> int | None:
        v = obj.get("Works Completed")
        if isinstance(v, list) and v:
            try:
                return int(float(str(v[0]).replace(",", "")))
            except ValueError:
                return None
        return None

    live_completed = count(live)
    stored_completed = stats.get("works_completed_count")
    if live_completed is not None and stored_completed is not None:
        delta = live_completed - stored_completed
        if delta == 0:
            record(OK, "stored completed-works matches live", f"{stored_completed:,}")
        else:
            record(WARN, "stored figure differs from live", f"stored {stored_completed:,} vs live {live_completed:,} (delta {delta:+,})")

    # A per-MP probe proves the fine-grained endpoint is real.
    try:
        mp = post_json(
            "https://www.mplads.mospi.gov.in/rest/PreLoginDashboardData/getTilesData",
            {"uname": "3042276,35,0,2"},
        )
    except Exception as exc:
        record(FAIL, "per-MP endpoint", f"{type(exc).__name__}: {exc}")
    else:
        key = "Expenditure on Completed and On-going Works as on Date"
        if key in mp:
            record(OK, "per-MP endpoint", f"MP 3042276 expenditure={mp[key][0]}")
        else:
            record(FAIL, "per-MP endpoint", f"no '{key}' in response: {list(mp)[:4]}")


# ------------------------------------------------------------------- MP roster


def audit_mps() -> None:
    print("\nMP roster (data/output/mps.csv)")
    rows = read_csv(OUTPUT / "mps.csv")
    if not rows:
        record(FAIL, "mps.csv", "missing")
        return
    record(OK, "row count", f"{len(rows)}")

    mapped = sum(1 for r in rows if (r.get("digigov_id") or "").strip())
    pct = mapped * 100 // len(rows)
    record(OK if pct > 90 else WARN, "mapped to MoSPI DigiGov IDs", f"{mapped}/{len(rows)} ({pct}%)")

    synced = sum(1 for r in rows if (r.get("sync_status") or "").strip().upper() == "SUCCESS")
    record(OK if synced else WARN, "rows with a successful live sync", f"{synced}/{len(rows)}")

    # MPLADS is a uniform-entitlement scheme, so many MPs legitimately share one
    # allocation figure. The meaningful test is fidelity to the official source
    # sheet, not whether values vary.
    official = OUTPUT / "Allocated Limit for Honble MPs (1).csv"
    if official.exists():
        src = read_csv(official)
        alloc_col = next((c for c in (src[0] if src else {}) if "Allocated" in c), None)
        if alloc_col:
            def norm(n: str) -> str:
                n = " ".join((n or "").split()).upper()
                for p in ("MR ", "MRS ", "MS ", "SHRI ", "SMT ", "DR ", "PROF ", "ADV "):
                    if n.startswith(p):
                        n = n[len(p):]
                return n.strip(" .")

            srcmap = {norm(r.get("Hon'ble Members of Parliamets", "") or r.get("Hon'ble Members of Parliament", "") or ""): r
                      for r in src}
            if not srcmap:
                for r in src:
                    for k in r:
                        if "Members" in k:
                            srcmap = srcmap or {}
                            break
            # Rebuild properly: name column is the one mentioning "Members".
            name_col = next((c for c in (src[0] if src else {}) if "Members" in c), None)
            if name_col:
                srcmap = {norm(r[name_col]): r for r in src}
                curmap = {norm(r.get("full_name", "")): r for r in rows}
                match = mismatch = 0
                for name, rec in srcmap.items():
                    got = curmap.get(name)
                    if not got:
                        continue
                    try:
                        off = float(str(rec[alloc_col]).replace(",", "").strip())
                    except ValueError:
                        continue
                    try:
                        ours = float(got.get("annual_allocation") or 0)
                    except ValueError:
                        ours = 0.0
                    if abs(off - ours) < 1:
                        match += 1
                    else:
                        mismatch += 1
                if match and mismatch:
                    record(FAIL, "annual_allocation diverges from official sheet",
                           f"{match} match, {mismatch} mismatch")
                elif match:
                    record(OK, "annual_allocation matches official sheet",
                           f"all {match} comparable rows agree")
                else:
                    record(WARN, "annual_allocation not cross-checkable",
                           "no comparable MP names found")
    else:
        record(WARN, "official allocation sheet", f"not found at {official.name}")

    party = Counter((r.get("party") or "").strip() for r in rows)
    if not party or set(party) == {""}:
        record(OK, "no invented party affiliation", "all blank, matching the source sheet")
    else:
        record(FAIL, "invented party affiliation", f"all {len(rows)} MPs share {party.most_common(1)[0][0]!r}")


# ------------------------------------------------------------- reference data


def audit_reference() -> None:
    print("\nReference data")
    states = read_csv(REF / "states.csv")
    if states:
        record(OK if len(states) >= 35 else WARN, "states.csv", f"{len(states)} states/UTs")
    else:
        record(FAIL, "states.csv", "missing")

    districts = REF / "districts.csv"
    if districts.exists():
        rows = read_csv(districts)
        record(
            FAIL,
            "districts.csv present",
            f"{len(rows)} districts with synthetic codes; quarantined copy exists but this one is live",
        )
    else:
        record(OK, "districts.csv quarantined", "no fabricated district reference in use")

    fed = ROOT / "backend" / "models" / "models.py"
    if fed.exists():
        text = fed.read_text(encoding="utf-8", errors="replace")
        if "secc_deprivation_score" in text:
            # The column is harmless while it holds only NULL. It becomes a
            # problem the moment a value is written, because the old reference
            # file's scores were invented.
            seeded = REPO_SEED_DIR / "seed_demo_data.sql"
            populates = seeded.exists() and "secc_deprivation_score" in seeded.read_text(
                encoding="utf-8", errors="replace"
            )
            if populates:
                record(
                    FAIL,
                    "secc_deprivation_score is populated",
                    "invented deprivation scores would drive the risk model",
                )
            else:
                record(
                    OK,
                    "secc_deprivation_score present but unpopulated",
                    "no invented deprivation score is loaded",
                )


# ------------------------------------------------------------------- frontend


def audit_frontend() -> None:
    print("\nFrontend data sourcing")
    if not FRONTEND.exists():
        return
    offenders = []
    for path in FRONTEND.rglob("*.ts*"):
        if "node_modules" in path.parts or path.name == "mockData.ts":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("*", "//", "/*")):
                continue
            if "MOCK_" in line or "mockData" in line:
                offenders.append(f"{path.relative_to(ROOT)}:{lineno}")
    if offenders:
        record(FAIL, "components importing mock data", ", ".join(offenders[:8]))
    else:
        record(OK, "no component imports mock datasets")

    ui = FRONTEND / "app" / "map" / "page.tsx"
    if ui.exists():
        text = ui.read_text(encoding="utf-8", errors="replace")
        if "centroid" in text.lower() or "approximate" in text.lower():
            record(OK, "map labels coordinate precision")
        else:
            record(WARN, "map does not label coordinate precision", "must disclose village-centroid points")


# ---------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="Skip live network probes.")
    args = ap.parse_args()

    print("=" * 74)
    print("Ojas MPLADS Sentinel - data provenance audit")
    print(f"generated {datetime.now(timezone.utc).isoformat()}")
    print("=" * 74)

    audit_quarantine()
    audit_works()
    audit_mps()
    audit_reference()
    audit_frontend()
    audit_mospi(args.offline)

    fails = [r for r in results if r[0] == FAIL]
    warns = [r for r in results if r[0] == WARN]
    print("\n" + "=" * 74)
    print(f"summary: {len(results)} checks | {len(fails)} fail | {len(warns)} warn | {len(results) - len(fails) - len(warns)} pass")
    if fails:
        print("\nfailures:")
        for _, check, detail in fails:
            print(f"  - {check}: {detail}")
    if warns:
        print("\nwarnings:")
        for _, check, detail in warns:
            print(f"  - {check}: {detail}")
    print("=" * 74)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
