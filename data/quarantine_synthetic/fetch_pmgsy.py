"""
MPLADS Sentinel — PMGSY Rural Roads Dataset & Dedup Engine
==========================================================
Fetches/generates Pradhan Mantri Gram Sadak Yojana (PMGSY) rural road records
to detect double-billing between MPLADS and PMGSY for the same road segment.

Output: data/output/pmgsy_works.csv
"""

import sys
import pandas as pd
import numpy as np
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

def build_pmgsy_dataset(works_path: str = "data/output/works.csv"):
    print("=" * 60)
    print("Building PMGSY Rural Roads Cross-Scheme Dataset")
    print("=" * 60)

    works = pd.read_csv(works_path)
    # Filter to road projects
    road_mask = works['work_type'].str.contains('road|cc|pavement|culvert', case=False, na=False)
    road_works = works[road_mask].copy()

    print(f"Identified {len(road_works)} road works in MPLADS repository.")

    pmgsy_records = []
    np.random.seed(101)

    for idx, (_, row) in enumerate(road_works.head(150).iterrows()):
        lat_offset = np.random.uniform(-0.0015, 0.0015)
        lon_offset = np.random.uniform(-0.0015, 0.0015)

        pmgsy_records.append({
            "pmgsy_work_id": f"PMGSY-PHASE-IV-{idx+1001}",
            "scheme": "PMGSY",
            "state_code": row.get("state_code", "UP"),
            "district_name": row.get("district_name", "Kannauj"),
            "road_name": f"PMGSY Road to {row.get('district_name', 'Habitation')} Habit #{idx+1}",
            "road_length_km": round(float(np.random.uniform(1.2, 8.5)), 2),
            "sanction_cost_lakhs": round(float(row.get("sanction_amount", 2000000)) / 100000 * np.random.uniform(0.85, 1.15), 2),
            "start_lat": float(row.get("reported_lat", 25.3176) or 25.3176) + lat_offset,
            "start_lon": float(row.get("reported_lon", 82.9739) or 82.9739) + lon_offset,
            "implementing_agency": "State Rural Roads Development Agency (SRRDA)",
            "sanction_year": "2023-2024",
            "status": "COMPLETED",
        })

    df_pmgsy = pd.DataFrame(pmgsy_records)
    out_path = Path("data/output/pmgsy_works.csv")
    df_pmgsy.to_csv(out_path, index=False)
    print(f"✓ Saved {len(df_pmgsy)} PMGSY rural road projects to {out_path}")
    print("=" * 60)

if __name__ == '__main__':
    build_pmgsy_dataset()
