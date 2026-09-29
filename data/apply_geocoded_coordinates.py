"""Merge only verified matches from the cached, real-coordinate sample.

This does not invent points or treat administrative centroids as surveyed work
GPS. Every imported coordinate retains `CENTROID` provenance.
"""
import csv
from pathlib import Path

DATA = Path(__file__).resolve().parent
WORKS = DATA / "output" / "works_real.csv"
SAMPLE = DATA / "output" / "works_real_geocoded_sample.csv"


def main() -> None:
    with WORKS.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
        columns = list(rows[0]) if rows else []
    with SAMPLE.open(encoding="utf-8-sig", newline="") as stream:
        sample = list(csv.DictReader(stream))

    by_row = {row.get("upstream_row"): row for row in rows}
    merged = 0
    for point in sample:
        target = by_row.get(point.get("upstream_row"))
        if not target:
            continue
        identity_fields = ("mp_name", "work_description", "village", "block")
        if any((target.get(key) or "").strip() != (point.get(key) or "").strip() for key in identity_fields):
            continue
        lat, lon = point.get("reported_lat"), point.get("reported_lon")
        if not lat or not lon:
            continue
        target["reported_lat"] = lat
        target["reported_lon"] = lon
        target["coordinate_precision"] = "CENTROID"
        merged += 1

    with WORKS.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Merged {merged} verified centroid coordinates; all other records remain unlocated.")


if __name__ == "__main__":
    main()
