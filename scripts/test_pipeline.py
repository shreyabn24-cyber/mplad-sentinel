import sys
import os
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

# Add backend and ml to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent / "ml"))

print("="*60)
print("🔍 MPLADS SENTINEL — FULL PIPELINE DIAGNOSTIC")
print("="*60)

# 1. Test Backend imports and routers
print("\n[1/5] Testing Backend imports & routing...")
try:
    from main import app
    print("  ✓ FastAPI core app loaded successfully!")
    routes = [r.path for r in app.routes if hasattr(r, 'path')]
    print(f"  ✓ {len(routes)} routes registered.")
    for r in sorted(routes)[:12]:
        print(f"    - {r}")
except Exception as e:
    print(f"  ❌ Backend import failed: {e}")
    import traceback
    traceback.print_exc()

# 2. Test ML Models loading
print("\n[2/5] Testing ML Model artifacts...")
try:
    from models.isolation_forest import IsolationForestDetector
    iso = IsolationForestDetector.load()
    print("  ✓ Isolation Forest model loaded successfully from disk.")
except Exception as e:
    print(f"  ❌ Isolation Forest load failed: {e}")

try:
    from models.contractor_graph import ContractorGraphAnalyzer
    graph = ContractorGraphAnalyzer.load()
    print("  ✓ Contractor Graph Analyzer loaded successfully from disk.")
except Exception as e:
    print(f"  ❌ Contractor Graph Analyzer load failed: {e}")

# 3. Test Ensemble Scorer
print("\n[3/5] Testing Ensemble Scorer...")
try:
    from ensemble.scorer import EnsembleScorer
    scorer = EnsembleScorer()
    test_res = scorer.score(
        work_id="TEST-001",
        signals={
            "isolation_score": 0.85,
            "satellite_score": 0.90,
            "weather_score": 0.80,
            "gstin_score": 0.85,
            "graph_score": 0.75,
            "cross_scheme_score": 0.95,
            "citizen_score": 0.90,
        }
    )
    print(f"  ✓ Ensemble Scorer operational: Score={test_res.composite_score:.1f}, Tier={test_res.confidence_tier}")
except Exception as e:
    print(f"  ❌ Ensemble Scorer failed: {e}")

# 4. Test Satellite API (AWS STAC)
print("\n[4/5] Testing AWS Earth Search STAC Satellite query...")
try:
    from models.satellite_detector import SatelliteChangeDetector
    det = SatelliteChangeDetector()
    scene = det.fetch_scene_from_aws(
        lat=25.3176,
        lon=82.9739,
        start_date="2023-01-01",
        end_date="2023-03-30",
        max_cloud_cover=30.0
    )
    if scene:
        print(f"  ✓ AWS STAC API operational: Found live Sentinel-2 scene: {scene.get('scene_id')}")
        thumb = scene.get("thumbnail_url")
        if thumb:
            print(f"    - Live AWS S3 Thumbnail: {thumb}")
    else:
        print("  ✓ AWS STAC query returned cleanly (no scene matching cloud cover filter).")
except Exception as e:
    print(f"  ⚠️ Satellite STAC query notice: {e}")

# 5. Test Weather API (Open-Meteo)
print("\n[5/5] Testing Open-Meteo Weather API...")
try:
    from models.weather_feasibility import WeatherFeasibilityChecker
    import datetime
    w_checker = WeatherFeasibilityChecker()
    w_res = w_checker.check(
        work_id="TEST-W-01",
        work_type="road",
        state_code="UP",
        district_code="DIST-UP-01",
        start_date=datetime.date(2023, 7, 1),
        end_date=datetime.date(2023, 7, 15),
        lat=26.8467,
        lon=80.9462
    )
    print(f"  ✓ Weather API operational: {w_res.heavy_rain_days}/{w_res.total_days} heavy rain days, Avg rain = {w_res.avg_rainfall_mm:.1f}mm, Flag = {w_res.feasibility_flag}")
except Exception as e:
    print(f"  ⚠️ Weather API notice: {e}")

print("\n" + "="*60)
print("DIAGNOSTIC TEST COMPLETE")
print("="*60)
