"""
MPLADS Sentinel — training on verified real data
================================================
Replaces the previous pipeline that trained on a generated 3,000-row
works.csv. That file was fabricated, so every model it produced measured
invented patterns rather than anything about real MPLADS works.

What this trains on
-------------------
* Isolation Forest over features derived only from fields the verified feed
  actually contains (see ml/features/real_features.py).
* MP-level aggregates compared against the live MoSPI figures in mps.csv.

What this deliberately does not train
------------------------------------
* Contractor graph. The open feed publishes no vendor identifier or GSTIN, so
  a contractor network cannot be built from real data. Building one from
  place names or agencies would assert vendor relationships that no source
  supports, so the endpoint continues to return an empty graph.
* Prophet fund-lapse forecasting. That model needs district-wise released and
  spent amounts over time. The open feed has no expenditure columns and no
  reliable district codes, so there is nothing honest to fit. Forecasting
  stays unavailable.
* GSTIN-compliance scoring. No GSTIN data is available.

Run:
    python ml/training/train_real.py
    python ml/training/train_real.py --data-dir data/output
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "ml"))

from ml.features.real_features import build_real_feature_matrix, engineer_real_features
from ml.models.isolation_forest import IsolationForestDetector

MODEL_DIR = ROOT / "ml" / "saved_models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def load_real_data(data_dir: Path) -> pd.DataFrame:
    works_path = data_dir / "works_real.csv"
    if not works_path.exists():
        print(f"ERROR: {works_path} not found.")
        print("Run: python data/fetch_real_works.py")
        raise SystemExit(1)

    df = pd.read_csv(works_path, dtype=str, keep_default_na=False, na_values=[""])
    print(f"Loaded {len(df):,} real work records from {works_path.name}")

    provenance = data_dir / "sync_manifest.json"
    if provenance.exists():
        try:
            man = json.loads(provenance.read_text(encoding="utf-8"))
            layers = man.get("layers", man)
            for name, info in layers.items():
                if isinstance(info, dict) and (info.get("source") or info.get("url")):
                    print(f"  provenance[{name}] = {info.get('source') or info.get('url')}")
        except (json.JSONDecodeError, AttributeError):
            pass

    return df


def train_isolation_forest(works: pd.DataFrame, contamination: float) -> tuple[IsolationForestDetector, pd.DataFrame, list[str]]:
    print("\nTraining Isolation Forest on real features")
    print("=" * 62)

    featured = engineer_real_features(works)
    X, feature_cols = build_real_feature_matrix(featured)
    print(f"  records : {len(featured):,}")
    print(f"  features: {len(feature_cols)}")

    detector = IsolationForestDetector(contamination=contamination, n_estimators=300)
    detector.model.set_params(n_estimators=300)
    detector.scaler.fit(X)
    detector.model.fit(detector.scaler.transform(X))
    detector.feature_cols = feature_cols
    detector.is_fitted = True

    scores = detector.score(featured)
    featured["anomaly_score"] = scores

    # Report where the threshold lands, and be explicit that the threshold is a
    # ranking device, not proof of wrongdoing.
    for cut in (0.5, 0.6, 0.7, 0.8, 0.9):
        n = int((scores >= cut).sum())
        print(f"  score >= {cut:.1f}: {n:6,} works ({n / len(scores):.2%})")

    top = featured.nlargest(10, "anomaly_score")
    print("\n  Highest-scoring works (review candidates, not findings):")
    for _, row in top.iterrows():
        print(
            f"    {row['anomaly_score']:.3f}  {str(row.get('constituency', ''))[:24]:24} "
            f"{str(row.get('work_description', ''))[:44]:44} INR {row.get('sanction_amount', 0):>12,.0f}"
        )

    return detector, featured, feature_cols


def save_artifacts(
    detector: IsolationForestDetector,
    featured: pd.DataFrame,
    feature_cols: list[str],
) -> Path:
    """Persist the model plus a manifest of what it was trained on."""
    detector.save()

    manifest = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_data": "data/output/works_real.csv",
        "records": int(len(featured)),
        "features": feature_cols,
        "source": "github.com/vonter/india-mplads-works (ODbL), scraped from mplads.mospi.gov.in",
        "source_date_note": "17th Lok Sabha snapshot published on the upstream repository; not a live per-work feed",
        "contamination": detector.contamination,
        "interpretation": (
            "Scores rank works by deviation from peer-group norms. A high score "
            "is a prompt for human review, not evidence of wrongdoing."
        ),
        "not_trained": {
            "contractor_graph": "no vendor identifier or GSTIN in the open feed",
            "prophet_lapse": "no district-wise released/spent time series available",
            "gstin_compliance": "no GSTIN data available",
        },
    }
    path = MODEL_DIR / "isolation_forest_manifest.json"
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nWrote training manifest to {path.relative_to(ROOT)}")

    # Persist scored works so the API can serve real scores without retraining.
    scored = featured[
        [
            "upstream_row",
            "mp_name",
            "constituency",
            "state_name",
            "work_type",
            "status",
            "sanction_amount",
            "anomaly_score",
        ]
    ].copy()
    scored_path = ROOT / "data" / "output" / "works_scored.csv"
    scored.to_csv(scored_path, index=False)
    print(f"Wrote {len(scored):,} scored works to {scored_path.relative_to(ROOT)}")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Train MPLADS models on verified real data")
    parser.add_argument("--data-dir", type=str, default=str(ROOT / "data" / "output"))
    parser.add_argument("--contamination", type=float, default=0.05)
    args = parser.parse_args()

    start = time.time()
    print("=" * 62)
    print("MPLADS Sentinel - training on verified real data")
    print("=" * 62)

    works = load_real_data(Path(args.data_dir))
    detector, featured, feature_cols = train_isolation_forest(works, args.contamination)
    save_artifacts(detector, featured, feature_cols)

    print(f"\nDone in {time.time() - start:.1f}s")
    print("Not trained, and why:")
    print("  contractor graph      no vendor id or GSTIN in the open feed")
    print("  prophet lapse         no district-wise expenditure series")
    print("  gstin compliance      no GSTIN data")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
