"""
Resumable background geocoding loop.

Runs data/geocode_works.py in chunks until every distinct place in
works_real.csv is resolved or definitively missed. Safe to interrupt: the
lookup cache is flushed to disk every chunk, so progress is never lost.

Launch detached:
    pythonw data/geocode_loop.py
    python data/geocode_loop.py --chunk 1500     # smaller chunks, more frequent saves
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TARGET = HERE / "output" / "works_real.csv"
LOG = ROOT / "data" / "raw" / "geocode_loop.log"
LOCK = HERE / "raw" / "geocode.lock"


def coverage() -> tuple[int, int]:
    """(geocoded works, total works) straight from the CSV."""
    import csv

    if not TARGET.exists():
        return 0, 0
    with TARGET.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    done = sum(1 for r in rows if r.get("reported_lat"))
    return done, len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunk", type=int, default=2000, help="Lookups per chunk.")
    ap.add_argument("--sleep", type=int, default=5, help="Pause between chunks.")
    ap.add_argument("--passes", type=int, default=40, help="Safety cap on chunk iterations.")
    ap.add_argument("--lock-wait", type=int, default=30,
                    help="Minutes to wait for another geocoder to release the lock.")
    ap.add_argument("--max-stalled", type=int, default=3,
                    help="Consecutive zero-progress chunks tolerated before stopping.")
    args = ap.parse_args()

    LOG.parent.mkdir(parents=True, exist_ok=True)

    # geocode_works.py holds a single-writer lock. If a scheduled sync or a
    # manual run already owns it, wait rather than spinning: without this the
    # loop would see zero progress, declare itself finished, and exit.
    for attempt in range(args.lock_wait * 6):
        if not LOCK.exists():
            break
        try:
            holder = LOCK.read_text(encoding="utf-8").strip()
        except OSError:
            holder = "?"
        print(f"waiting for geocoder lock (pid {holder}), attempt {attempt + 1}", flush=True)
        time.sleep(10)
    else:
        print("Lock never freed; exiting so the other run can finish.", flush=True)
        return 0

    stalled = 0
    for i in range(1, args.passes + 1):
        done, total = coverage()
        print(f"[chunk {i}] before: {done:,}/{total:,} works geocoded", flush=True)
        if done >= total:
            print("All works geocoded. Done.", flush=True)
            return 0

        started = time.time()
        proc = subprocess.run(
            [
                sys.executable,
                str(HERE / "geocode_works.py"),
                "--max-lookups",
                str(args.chunk),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(ROOT),
        )
        tail = (proc.stdout or "").strip().splitlines()[-12:]
        for line in tail:
            print(f"    {line}", flush=True)
        if proc.returncode != 0:
            print(f"    geocoder exited {proc.returncode}: {(proc.stderr or '')[-400:]}", flush=True)

        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"=== chunk {i} @ {time.strftime('%Y-%m-%d %H:%M:%S')} ({time.time()-started:.0f}s) ===\n")
            fh.write((proc.stdout or "")[-4000:] + "\n")

        after, _ = coverage()
        print(f"[chunk {i}] after: {after:,}/{total:,}  (+{after-done:,} in {time.time()-started:.0f}s)", flush=True)
        if after == done:
            # A chunk can legitimately resolve zero places when the cache
            # already covered everything the ordering surfaced. Keep going
            # rather than exiting, but stop if repeated.
            stalled += 1
            if stalled >= args.max_stalled:
                print(f"No progress in {stalled} consecutive chunks; stopping.", flush=True)
                return 0
        else:
            stalled = 0
        time.sleep(args.sleep)

    print("Reached chunk cap; rerun to continue.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
