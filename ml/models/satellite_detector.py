"""
MPLADS Sentinel — Satellite Scene Locator
==========================================
Locates real Sentinel-2 L2A scenes for a work location via the AWS Open Data
STAC API (Earth Search by Element84):
  Endpoint: https://earth-search.aws.element84.com/v1/search
  Collection: sentinel-2-l2a (Cloud-Optimized GeoTIFFs on AWS S3)
  Fully open, free, requires NO API key.

SCOPE / HONESTY NOTE
--------------------
This module performs a *scene search only*. A STAC search returns scene
metadata (scene id, acquisition datetime, cloud cover, thumbnail href). It does
**not** return pixel values.

Computing NDBI/NDVI requires reading the B02 (red), B03 (green), B04 (blue),
B08 (nir) and B11 (swir) bands of the COG and reducing them per-pixel. That
band-read/reduce stage is **not implemented** in this build (rasterio is an
optional dependency and no windowed-read code path exists).

Consequently this module never emits a computed index delta, never emits a
`satellite_flag`, and never emits a change score. Doing so previously required
fabricating them with `numpy.random` seeded by the work id and copying the
verdict out of the risk model, then labelling the output
"AWS Open Data (Sentinel-2 L2A COGs)" with evidence text asserting that a
"radar pass" confirmed absence of a structure. That produced fabricated
physical evidence attributed to a real satellite agency.

The honest output is therefore: *where* the imagery is, *when* it was captured
and *how cloudy* it is — plus an explicit INCONCLUSIVE verdict stating that
index computation is not implemented. `status` is one of:

  OK           – both scenes located; no index computed (see HONESTY NOTE)
  INCONCLUSIVE – scenes partially/fully located but insufficient to judge
  UNAVAILABLE  – no scene in window, coordinates absent, or no network
  NOT_APPLICABLE – work type below the 10m resolution of Sentinel-2

Sentinel-2 is an *optical* instrument. It has no radar band; do not describe
its output as a radar pass.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    import rasterio
    RASTERIO_AVAILABLE = True
except ImportError:
    RASTERIO_AVAILABLE = False

MODEL_DIR = Path(__file__).parent.parent / "saved_models"

# Free AWS STAC endpoint for Sentinel-2 Open Data
AWS_EARTH_SEARCH_URL = "https://earth-search.aws.element84.com/v1/search"

# Construction detection thresholds by work type.
# `None` means the work type's physical footprint is below the 10m resolution
# of the Sentinel-2 L2A grid, so the check cannot be resolved at any effort.
CONSTRUCTION_THRESHOLDS = {
    'road':             {'ndbi_min': 0.05,  'ndvi_max': -0.10},
    'cc_road':          {'ndbi_min': 0.06,  'ndvi_max': -0.12},
    'community_hall':   {'ndbi_min': 0.08,  'ndvi_max': -0.08},
    'school_building':  {'ndbi_min': 0.07,  'ndvi_max': -0.08},
    'health_center':    {'ndbi_min': 0.07,  'ndvi_max': -0.08},
    'stadium':          {'ndbi_min': 0.10,  'ndvi_max': -0.05},
    'library':          {'ndbi_min': 0.08,  'ndvi_max': -0.08},
    'drainage':         {'ndbi_min': 0.03,  'ndvi_max': -0.15},
    # These don't show up at 10m resolution — skip satellite check
    'borewell':         None,
    'solar_lights':     None,
    'plantation':       None,
    'anganwadi':        None,
}


@dataclass
class SatelliteResult:
    """Outcome of a scene *search*.

    Index fields are Optional and are expected to be None in this build: no
    band-read stage is implemented, so no index delta can be measured. `None`
    means "not measured" and must never be rendered as 0.0.
    """

    work_id: str
    status: str = "UNAVAILABLE"     # OK | INCONCLUSIVE | UNAVAILABLE | NOT_APPLICABLE
    date_before: str = ""
    date_after: str = ""
    ndbi_before: Optional[float] = None
    ndbi_after: Optional[float] = None
    ndbi_change: Optional[float] = None
    ndvi_before: Optional[float] = None
    ndvi_after: Optional[float] = None
    ndvi_change: Optional[float] = None
    change_score: Optional[float] = None      # not measured in this build
    satellite_flag: Optional[bool] = None     # None = no verdict reached
    confidence: Optional[float] = None        # scene-metadata quality only, not index confidence
    cloud_coverage_pct: Optional[float] = None
    applicable: bool = True                   # False for work types below 10m resolution
    evidence_text: str = ""
    thumbnail_before_url: Optional[str] = None
    thumbnail_after_url: Optional[str] = None
    scene_id_before: Optional[str] = None
    scene_id_after: Optional[str] = None
    data_source: str = "AWS Open Data (Sentinel-2 L2A) — scene metadata only"


class SatelliteChangeDetector:
    """
    Detects ghost projects using before/after Sentinel-2 imagery analysis.
    Directly pulls authentic satellite data from the AWS Open Data STAC API.
    """

    def __init__(self, buffer_m: int = 200):
        self.buffer_m = buffer_m

    def fetch_scene_from_aws(
        self,
        lat: float,
        lon: float,
        start_date: str,
        end_date: str,
        max_cloud_cover: float = 25.0,
    ) -> Optional[dict]:
        """
        Query real Sentinel-2 L2A scene metadata from AWS Open Data STAC API.
        No API key required.
        """
        if not REQUESTS_AVAILABLE:
            return None

        payload = {
            "collections": ["sentinel-2-l2a"],
            "intersects": {
                "type": "Point",
                "coordinates": [round(lon, 4), round(lat, 4)]
            },
            "datetime": f"{start_date}T00:00:00Z/{end_date}T23:59:59Z",
            "query": {
                "eo:cloud_cover": {"lt": max_cloud_cover}
            },
            "limit": 1
        }

        try:
            resp = requests.post(AWS_EARTH_SEARCH_URL, json=payload, timeout=12)
            resp.raise_for_status()
            data = resp.json()
            features = data.get("features", [])
            if not features:
                return None

            feat = features[0]
            props = feat.get("properties", {})
            assets = feat.get("assets", {})

            # AWS S3 thumbnail URL or preview
            thumb_url = assets.get("thumbnail", {}).get("href") or assets.get("rendered_preview", {}).get("href")
            visual_url = assets.get("visual", {}).get("href")

            return {
                "scene_id": feat.get("id"),
                "datetime": props.get("datetime", "")[:10],
                "cloud_cover": float(props.get("eo:cloud_cover", 0.0)),
                "thumbnail_url": thumb_url,
                "visual_url": visual_url,
                "nir_url": assets.get("nir", {}).get("href"),
                "swir_url": assets.get("swir16", {}).get("href"),
            }
        except Exception as e:
            print(f"[AWS Satellite] STAC query failed ({type(e).__name__}: {e})")
            return None

    def check_work_aws(
        self,
        work_id: str,
        lat: Optional[float],
        lon: Optional[float],
        work_type: str,
        sanction_date: Optional[date] = None,
        completion_date: Optional[date] = None,
    ) -> SatelliteResult:
        """Locate before/after Sentinel-2 scenes for a work.

        Returns metadata only. No index delta, no change score and no
        satellite_flag is produced, because no band-read/reduce stage exists in
        this build (see module HONESTY NOTE). An unavailable search is reported
        as UNAVAILABLE rather than substituted with simulated values.
        """
        if CONSTRUCTION_THRESHOLDS.get(work_type) is None:
            return SatelliteResult(
                work_id=work_id,
                status="NOT_APPLICABLE",
                applicable=False,
                evidence_text=(
                    f"Satellite check is not applicable to '{work_type}' works: the physical "
                    f"footprint is below the 10m resolution of the Sentinel-2 L2A grid. "
                    f"No imagery was consulted and no verdict is implied."
                ),
                data_source="N/A — not applicable at 10m resolution",
            )

        if lat is None or lon is None:
            return SatelliteResult(
                work_id=work_id,
                status="UNAVAILABLE",
                applicable=True,
                evidence_text=(
                    "Satellite check not run: this work has no reported coordinates. "
                    "No default or approximate location was substituted, because a search at "
                    "the wrong coordinates would produce imagery that does not depict the work."
                ),
                data_source="None — coordinates absent",
            )

        if not REQUESTS_AVAILABLE:
            return SatelliteResult(
                work_id=work_id,
                status="UNAVAILABLE",
                applicable=True,
                evidence_text=(
                    "Satellite check not run: the 'requests' package is not installed in this "
                    "environment, so the AWS STAC catalogue could not be queried."
                ),
                data_source="None — HTTP client unavailable",
            )

        s_date = sanction_date or (date.today() - timedelta(days=365))
        c_date = completion_date or date.today()

        before_start = (s_date - timedelta(days=90)).isoformat()
        before_end = s_date.isoformat()
        after_start = (c_date - timedelta(days=45)).isoformat()
        after_end = (c_date + timedelta(days=90)).isoformat()

        scene_before = self.fetch_scene_from_aws(lat, lon, before_start, before_end)
        scene_after = self.fetch_scene_from_aws(lat, lon, after_start, after_end)

        found = [s for s in (scene_before, scene_after) if s]

        if not found:
            return SatelliteResult(
                work_id=work_id,
                status="UNAVAILABLE",
                applicable=True,
                evidence_text=(
                    "No Sentinel-2 L2A scene returned by the AWS Earth Search catalogue for this "
                    "location in the requested windows "
                    f"({before_start} to {before_end}, {after_start} to {after_end}). "
                    "This may mean cloud cover, an out-of-catalogue footprint, or a network "
                    "failure. It is not evidence of anything about the work."
                ),
                data_source="AWS Earth Search STAC (sentinel-2-l2a) — query returned no scenes",
            )

        clouds = [s["cloud_cover"] for s in found]
        avg_cloud = round(sum(clouds) / len(clouds), 1)

        evidence = self._build_evidence_text(
            work_type=work_type,
            scene_count=len(found),
            avg_cloud=avg_cloud,
            before=scene_before,
            after=scene_after,
        )

        return SatelliteResult(
            work_id=work_id,
            status="OK" if len(found) == 2 else "INCONCLUSIVE",
            date_before=scene_before["datetime"] if scene_before else "",
            date_after=scene_after["datetime"] if scene_after else "",
            # Index fields deliberately None: not measured. See module HONESTY NOTE.
            ndbi_before=None,
            ndbi_after=None,
            ndbi_change=None,
            ndvi_before=None,
            ndvi_after=None,
            ndvi_change=None,
            change_score=None,
            satellite_flag=None,
            # Scene-metadata quality, explicitly not a confidence in any index.
            confidence=round(max(0.0, 1.0 - (avg_cloud / 100)), 2),
            cloud_coverage_pct=avg_cloud,
            applicable=True,
            evidence_text=evidence,
            thumbnail_before_url=scene_before["thumbnail_url"] if scene_before else None,
            thumbnail_after_url=scene_after["thumbnail_url"] if scene_after else None,
            scene_id_before=scene_before["scene_id"] if scene_before else None,
            scene_id_after=scene_after["scene_id"] if scene_after else None,
            data_source="AWS Open Data (Sentinel-2 L2A COGs) — scene metadata only",
        )

    def _build_evidence_text(
        self,
        work_type: str,
        scene_count: int,
        avg_cloud: float,
        before: Optional[dict],
        after: Optional[dict],
    ) -> str:
        """Describe what was actually observed: scene locations and metadata.

        Deliberately does not assert construction present/absent. Nothing here
        inspects pixels, so no such assertion can be supported.
        """
        lines = [
            f"Sentinel-2 L2A scene search completed for a '{work_type}' work via AWS Earth Search. "
            f"{scene_count} of 2 required scenes located; mean cloud cover {avg_cloud:.1f}%."
        ]
        if before:
            lines.append(
                f"Pre-construction scene {before['scene_id']} captured {before['datetime']} "
                f"(cloud cover {before['cloud_cover']:.1f}%)."
            )
        if after:
            lines.append(
                f"Post-construction scene {after['scene_id']} captured {after['datetime']} "
                f"(cloud cover {after['cloud_cover']:.1f}%)."
            )
        if scene_count < 2:
            lines.append(
                "A before/after pair could not be established, so no comparison is possible."
            )
        lines.append(
            "NO INDEX DELTA IS REPORTED. Computing NDBI/NDVI requires reading the B02/B03/B04/"
            "B08/B11 bands of the COGs and reducing them per-pixel; that band-read stage is not "
            "implemented in this build. The imagery URLs above are the scenes to inspect; the "
            "thresholds this work type would be tested against are NDBI ≥ "
            f"{CONSTRUCTION_THRESHOLDS.get(work_type, {}).get('ndbi_min')} and NDVI ≤ "
            f"{CONSTRUCTION_THRESHOLDS.get(work_type, {}).get('ndvi_max')}. "
            "This check therefore returns no construction/absence verdict and must not be cited "
            "as evidence either way."
        )
        return " ".join(lines)

    # NOTE: A `simulate_satellite_check` helper used to live here. It generated
    # NDBI/NDVI/flag values with numpy.random (seeded by work id) plus the
    # caller's own risk verdict, and returned them tagged
    # data_source="AWS Open Data (Sentinel-2 L2A)". `check_work_aws` called it
    # whenever coordinates were missing or the STAC request failed, so a total
    # network outage produced confident fabricated satellite evidence against
    # named officials. It has been removed: an unavailable search is now
    # reported as UNAVAILABLE. Do not reintroduce a simulation path that
    # returns SatelliteResult � if test fixtures are needed, give them a
    # separate return type that cannot be mistaken for an observation.

