"""
MPLADS Sentinel — Master Training Script
=========================================
Runs all ML models in sequence. Execute from the project root.

Usage:
    cd ml && python training/train_all.py
    cd ml && python training/train_all.py --data-dir ../data/output
"""

import argparse
import sys
import time
from pathlib import Path
from typing import Optional

sys.stdout.reconfigure(encoding='utf-8')

# Add parent directories to path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import pandas as pd

from features.feature_engineering import engineer_all_features, build_feature_matrix
from models.isolation_forest import IsolationForestDetector
from models.prophet_lapse import LapsePredictor, generate_quarterly_demo_data, PROPHET_AVAILABLE
from models.contractor_graph import ContractorGraphAnalyzer


def load_data(data_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load synthetic or real data from CSVs."""
    works_path = data_dir / 'works.csv'
    contractors_path = data_dir / 'contractors.csv'
    mps_path = data_dir / 'mps.csv'

    if not works_path.exists():
        print(f"❌ Data not found at {data_dir}")
        print("   Run: python data/process_real_mps.py")
        sys.exit(1)

    print(f"📂 Loading data from {data_dir}")
    works_df = pd.read_csv(works_path)
    contractors_df = pd.read_csv(contractors_path)
    mps_df = pd.read_csv(mps_path)

    print(f"   ✓ Works: {len(works_df):,}")
    print(f"   ✓ Contractors: {len(contractors_df):,}")
    print(f"   ✓ MPs: {len(mps_df):,}")

    return works_df, contractors_df, mps_df


def train_isolation_forest(works_df: pd.DataFrame) -> IsolationForestDetector:
    print("\n" + "="*50)
    print("🔧 Training Isolation Forest (Tabular Anomaly Detector)")
    print("="*50)

    # Feature engineering
    works_fe = engineer_all_features(works_df)
    X, feature_cols = build_feature_matrix(works_fe)
    print(f"   Features: {feature_cols}")
    print(f"   Records:  {len(works_fe):,}")

    detector = IsolationForestDetector(contamination=0.05)
    detector.fit(works_fe, feature_cols)
    detector.save()

    # Quick validation
    scores = detector.score(works_fe)
    anomalous = (scores > 0.7).sum()
    print(f"   High-risk works (>0.7): {anomalous:,} ({anomalous/len(works_fe):.1%})")
    return detector


def train_prophet(quarterly_df: pd.DataFrame):
    if not PROPHET_AVAILABLE:
        print("\n[Notice] Prophet not installed. Skipping Prophet training.")
        return None

    print("\n" + "="*50)
    print("🔧 Training Prophet Fund Lapse Predictors")
    print("="*50)

    predictor = LapsePredictor(entity_col='district_code')
    predictor.fit(quarterly_df)
    predictor.save()

    # Show top lapse risks
    sample_districts = quarterly_df['district_code'].unique()[:3]
    for dist in sample_districts:
        result = predictor.predict_lapse(
            entity_id=dist,
            allocated_amount=5_000_000,
            current_spent=quarterly_df[quarterly_df['district_code'] == dist]['spent_amount'].sum()
        )
        print(f"   {dist}: Lapse prob {result['lapse_probability']:.0%} | Tier: {result['lapse_tier']}")

    return predictor


def train_contractor_graph(works_df: pd.DataFrame) -> ContractorGraphAnalyzer:
    print("\n" + "="*50)
    print("🔧 Building Contractor Network Graph")
    print("="*50)

    analyzer = ContractorGraphAnalyzer()
    analyzer.build_graph(works_df)
    analyzer.detect_communities()
    analyzer.score_contractors(works_df)
    analyzer.score_mp(works_df)
    analyzer.save()

    suspicious = analyzer.get_suspicious_clusters()
    print(f"   Suspicious clusters found: {len(suspicious)}")
    for cluster in suspicious[:3]:
        print(f"   Community {cluster['community_id']}: {len(cluster['contractors'])} contractors, "
              f"risk={cluster['avg_risk_score']:.2f}")

    return analyzer


def run_demo_scoring(
    works_df: pd.DataFrame,
    contractors_df: pd.DataFrame,
    detector: IsolationForestDetector,
    analyzer: Optional[ContractorGraphAnalyzer] = None,
) -> None:
    """Score all works and display tier distribution."""
    print("\n" + "="*50)
    print("📊 Running Demo Ensemble Scoring")
    print("="*50)

    from ensemble.scorer import EnsembleScorer
    from models.weather_feasibility import WeatherFeasibilityChecker
    
    works_fe = engineer_all_features(works_df)
    isolation_scores = detector.score(works_fe)

    # Build contractor risk map from real contractors table
    gstin_status_map = dict(zip(contractors_df['gstin'], contractors_df['gstin_status']))
    status_score_map = {'CANCELLED': 0.95, 'SUSPENDED': 0.85, 'INACTIVE': 0.60, 'ACTIVE': 0.0}

    # Weather checker
    weather_checker = WeatherFeasibilityChecker()

    scorer = EnsembleScorer()
    tiers = {'L1': 0, 'L2': 0, 'L3': 0, None: 0}

    for i, (_, row) in enumerate(works_fe.iterrows()):
        gstin = row.get('contractor_gstin', '')
        c_status = gstin_status_map.get(gstin, 'ACTIVE')
        gstin_score = status_score_map.get(c_status, 0.0)

        graph_score = 0.0
        if analyzer and hasattr(analyzer, 'contractor_metrics') and gstin in analyzer.contractor_metrics:
            graph_score = float(analyzer.contractor_metrics[gstin].get('risk_score', 0.0))

        # Check weather feasibility only for candidate high-risk works to avoid throttling
        weather_score = 0.0
        if isolation_scores[i] > 0.65 and row.get('reported_lat') and row.get('reported_lon') and pd.notna(row.get('sanction_date')):
            try:
                s_date = pd.to_datetime(row['sanction_date']).date()
                c_date = pd.to_datetime(row['completion_date']).date() if pd.notna(row.get('completion_date')) else s_date
                w_res = weather_checker.check(
                    row['work_id'], row['work_type'], row['state_code'], row['district_code'],
                    s_date, c_date, lat=row['reported_lat'], lon=row['reported_lon']
                )
                weather_score = weather_checker.score(w_res)
            except Exception:
                weather_score = 0.0

        result = scorer.score(
            work_id=row['work_id'],
            signals={
                'isolation_score': float(isolation_scores[i]),
                'satellite_score': 0.0,
                'weather_score': weather_score,
                'gstin_score': gstin_score,
                'graph_score': graph_score,
                'cross_scheme_score': 0.0,
                'citizen_score': 0.0,
            }
        )
        tiers[result.confidence_tier] = tiers.get(result.confidence_tier, 0) + 1

    total = len(works_fe)
    print(f"   L1 (Informational):      {tiers.get('L1', 0):4d} ({tiers.get('L1', 0)/total:.1%})")
    print(f"   L2 (Needs Review):       {tiers.get('L2', 0):4d} ({tiers.get('L2', 0)/total:.1%})")
    print(f"   L3 (High-Confidence):    {tiers.get('L3', 0):4d} ({tiers.get('L3', 0)/total:.1%})")
    print(f"   No Flag:                 {tiers.get(None, 0):4d} ({tiers.get(None, 0)/total:.1%})")


def main():
    parser = argparse.ArgumentParser(description='MPLADS Sentinel Model Training')
    parser.add_argument('--data-dir', type=str, default='../data/output')
    parser.add_argument('--skip-prophet', action='store_true')
    parser.add_argument('--skip-graph', action='store_true')
    args = parser.parse_args()

    start_time = time.time()
    data_dir = Path(args.data_dir)

    print("🛡️  MPLADS Sentinel — Model Training Pipeline")
    print("=" * 50)

    # Load data
    works_df, contractors_df, mps_df = load_data(data_dir)

    # Train models
    detector = train_isolation_forest(works_df)

    if not args.skip_prophet:
        print("\n📅 Aggregating quarterly expenditure time series from works data...")
        from models.prophet_lapse import build_quarterly_timeseries
        quarterly_df = build_quarterly_timeseries(works_df)
        predictor = train_prophet(quarterly_df)

    if not args.skip_graph:
        analyzer = train_contractor_graph(works_df)

    # Run demo scoring across works with real signals
    run_demo_scoring(works_df, contractors_df, detector, analyzer if not args.skip_graph else None)

    elapsed = time.time() - start_time
    print(f"\n✅ Training complete in {elapsed:.1f}s")
    print(f"   Models saved to: ml/saved_models/")


if __name__ == '__main__':
    main()
