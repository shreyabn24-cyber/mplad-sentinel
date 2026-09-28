"""
MPLADS Sentinel — Weather Feasibility Checker
=============================================
Cross-checks claimed construction timelines against real precipitation data
from Open-Meteo (https://open-meteo.com) to detect physically impossible
completion claims.

No API key required — Open-Meteo is fully open and free.

Data sources:
  Historical (>5 days ago) : https://archive-api.open-meteo.com/v1/archive
  Recent / forecast        : https://api.open-meteo.com/v1/forecast
  Fallback (no lat/lon)    : IMD monthly climatological normals (simulated)
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import numpy as np

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# Open-Meteo endpoints (no API key needed)
OPEN_METEO_ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Archive API lags ~5 days behind today
ARCHIVE_LAG_DAYS = 5

# Rainfall thresholds (mm/day) beyond which work type is infeasible
RAIN_THRESHOLDS = {
    'road':             30,   # Bitumen/road laying halted in heavy rain
    'cc_road':          25,   # Concrete cannot cure in heavy rain
    'community_hall':   25,
    'school_building':  25,
    'health_center':    25,
    'stadium':          30,
    'library':          25,
    'drainage':         50,   # Earthwork possible in moderate rain
    'borewell':         0,    # Drilling unaffected by rain
    'solar_lights':     0,    # Installation possible in light rain
    'plantation':       0,    # Rain helps
    'anganwadi':        25,
}

# Fraction of infeasible days that triggers a flag
INFEASIBILITY_THRESHOLD = 0.60   # >60% infeasible days = flag


@dataclass
class WeatherCheckResult:
    work_id: str
    start_date: date
    end_date: date
    total_days: int
    heavy_rain_days: int
    avg_rainfall_mm: float
    max_rainfall_mm: float
    rain_threshold_mm: float
    infeasibility_ratio: float
    feasibility_flag: bool
    evidence_text: str
    data_source: str = "Open-Meteo"  # 'Open-Meteo' or 'IMD Normals (simulated)'


# ── Simulated IMD district-wise monthly rainfall (mm) ─────────────────────────
# Based on IMD normals 1981–2010. Keyed by state_code.
IMD_MONTHLY_NORMALS = {
    'MH': [3, 1, 2, 5, 17, 147, 340, 312, 186, 75, 22, 5],
    'UP': [21, 17, 11, 4, 10, 54, 230, 297, 183, 36, 5, 12],
    'MP': [14, 10, 11, 3, 7, 90, 310, 370, 206, 38, 10, 8],
    'RJ': [7, 7, 4, 2, 8, 27, 118, 164, 64, 13, 3, 5],
    'GJ': [2, 1, 1, 1, 6, 71, 252, 246, 108, 22, 8, 2],
    'KA': [5, 7, 14, 35, 96, 105, 96, 104, 166, 165, 54, 12],
    'TN': [37, 26, 15, 20, 38, 33, 36, 101, 114, 160, 308, 136],
    'WB': [17, 22, 33, 47, 121, 246, 318, 326, 251, 144, 38, 13],
    'AP': [9, 13, 14, 21, 60, 80, 120, 110, 158, 144, 88, 29],
    'TS': [7, 8, 12, 18, 59, 91, 160, 168, 150, 85, 39, 12],
    'BR': [19, 13, 9, 7, 17, 85, 283, 303, 207, 55, 8, 7],
    'OR': [18, 20, 25, 24, 67, 178, 345, 359, 254, 130, 39, 18],
    'HR': [24, 18, 15, 7, 16, 37, 150, 173, 93, 20, 4, 18],
    'PB': [40, 27, 21, 10, 17, 30, 130, 155, 75, 18, 5, 25],
    'DL': [28, 18, 14, 6, 14, 46, 166, 188, 95, 18, 5, 22],
}


class WeatherFeasibilityChecker:
    """
    Checks whether a claimed construction timeline is meteorologically feasible
    using real precipitation data from Open-Meteo (no API key required).

    Pass lat/lon from Work.reported_lat/reported_lon or District.latitude/longitude
    to get real data. Without lat/lon falls back to IMD monthly normals.
    """

    def __init__(self):
        pass  # Open-Meteo requires no credentials

    def fetch_rainfall_data(
        self,
        state_code: str,
        district_code: str,
        start_date: date,
        end_date: date,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
    ) -> tuple[list[dict], str]:
        """
        Fetch daily rainfall records for a date range.

        Returns:
            (records, data_source)
            records     : List of {'date': 'YYYY-MM-DD', 'rainfall_mm': float}
            data_source : 'Open-Meteo' or 'IMD Normals (simulated)'
        """
        if lat is not None and lon is not None and REQUESTS_AVAILABLE:
            try:
                records = self._fetch_from_open_meteo(lat, lon, start_date, end_date)
                return records, "Open-Meteo"
            except Exception as e:
                print(f"Open-Meteo API failed ({type(e).__name__}: {e}). "
                      f"Falling back to IMD climatological normals.")

        return self._simulate_from_normals(state_code, start_date, end_date), "IMD Normals (simulated)"

    def _fetch_from_open_meteo(
        self, lat: float, lon: float, start_date: date, end_date: date
    ) -> list[dict]:
        """
        Fetch real daily precipitation from Open-Meteo.
        Routes to archive endpoint for historical and forecast for recent dates.
        Combines both segments automatically when the range spans the boundary.
        """
        today          = date.today()
        archive_cutoff = today - timedelta(days=ARCHIVE_LAG_DAYS)
        records: list[dict] = []

        # Historical segment (>5 days ago) → archive API (goes back to 1940)
        if start_date <= archive_cutoff:
            hist_end = min(end_date, archive_cutoff)
            records.extend(
                self._query_open_meteo(
                    OPEN_METEO_ARCHIVE_URL, lat, lon, start_date, hist_end
                )
            )

        # Recent / future segment → forecast API (up to 16 days ahead)
        if end_date > archive_cutoff:
            fcast_start = max(start_date, archive_cutoff + timedelta(days=1))
            records.extend(
                self._query_open_meteo(
                    OPEN_METEO_FORECAST_URL, lat, lon, fcast_start, end_date
                )
            )

        return records

    def _query_open_meteo(
        self, url: str, lat: float, lon: float, start_date: date, end_date: date
    ) -> list[dict]:
        """Single Open-Meteo HTTP call. Returns list of {date, rainfall_mm}."""
        params = {
            "latitude":   round(lat, 4),
            "longitude":  round(lon, 4),
            "start_date": start_date.isoformat(),
            "end_date":   end_date.isoformat(),
            "daily":      "precipitation_sum,rain_sum,weathercode",
            "timezone":   "Asia/Kolkata",
        }
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        times  = data["daily"]["time"]
        precip = data["daily"]["precipitation_sum"]  # total precipitation (mm)

        return [
            {
                "date":        t,
                "rainfall_mm": round(float(p) if p is not None else 0.0, 1),
            }
            for t, p in zip(times, precip)
        ]

    def _simulate_from_normals(
        self, state_code: str, start_date: date, end_date: date
    ) -> list[dict]:
        """
        Simulate daily rainfall from IMD monthly normals using a Gamma distribution.
        Matches the statistical characteristics of real rainfall data.
        """
        normals = IMD_MONTHLY_NORMALS.get(state_code, IMD_MONTHLY_NORMALS['MH'])
        records = []
        current = start_date
        rng = np.random.default_rng(
            (start_date.year * 10000 + start_date.month * 100 + start_date.day)
        )

        while current <= end_date:
            month_idx = current.month - 1
            monthly_normal = normals[month_idx]
            daily_normal = monthly_normal / 30.0

            # Gamma distribution for rainfall (realistic)
            if daily_normal > 0:
                shape = 0.3
                scale = daily_normal / shape
                rainfall = float(rng.gamma(shape, scale))
                # Rain is intermittent — zero on ~60% of days outside monsoon
                if monthly_normal < 50 and rng.random() < 0.7:
                    rainfall = 0.0
            else:
                rainfall = 0.0

            records.append({
                'date': current.isoformat(),
                'rainfall_mm': round(rainfall, 1),
            })
            current += timedelta(days=1)

        return records

    def check(
        self,
        work_id: str,
        work_type: str,
        state_code: str,
        district_code: str,
        start_date: date,
        end_date: date,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
    ) -> WeatherCheckResult:
        """Main feasibility check for a work's claimed construction period."""

        threshold = RAIN_THRESHOLDS.get(work_type, 30)

        # Work types unaffected by rain — skip API call entirely
        if threshold == 0:
            return WeatherCheckResult(
                work_id=work_id,
                start_date=start_date,
                end_date=end_date,
                total_days=(end_date - start_date).days,
                heavy_rain_days=0,
                avg_rainfall_mm=0.0,
                max_rainfall_mm=0.0,
                rain_threshold_mm=0.0,
                infeasibility_ratio=0.0,
                feasibility_flag=False,
                evidence_text=f'{work_type} is not affected by rainfall conditions.',
                data_source='N/A',
            )

        # Fetch real rainfall data from Open-Meteo (or fallback)
        rainfall_data, data_source = self.fetch_rainfall_data(
            state_code, district_code, start_date, end_date, lat=lat, lon=lon
        )
        rainfall_values = [r['rainfall_mm'] for r in rainfall_data]

        total_days = len(rainfall_values)
        heavy_rain_days = sum(1 for r in rainfall_values if r > threshold)
        avg_rainfall = float(np.mean(rainfall_values)) if rainfall_values else 0.0
        max_rainfall = float(np.max(rainfall_values)) if rainfall_values else 0.0
        infeasibility_ratio = heavy_rain_days / total_days if total_days > 0 else 0.0
        feasibility_flag = infeasibility_ratio > INFEASIBILITY_THRESHOLD

        evidence_text = self._build_evidence_text(
            work_type, heavy_rain_days, total_days, threshold,
            infeasibility_ratio, feasibility_flag, start_date, end_date, data_source,
        )

        return WeatherCheckResult(
            work_id=work_id,
            start_date=start_date,
            end_date=end_date,
            total_days=total_days,
            heavy_rain_days=heavy_rain_days,
            avg_rainfall_mm=round(avg_rainfall, 1),
            max_rainfall_mm=round(max_rainfall, 1),
            rain_threshold_mm=float(threshold),
            infeasibility_ratio=round(infeasibility_ratio, 3),
            feasibility_flag=feasibility_flag,
            evidence_text=evidence_text,
            data_source=data_source,
        )

    def _build_evidence_text(
        self, work_type, heavy_rain_days, total_days, threshold,
        infeasibility_ratio, is_flag, start_date, end_date, data_source="Open-Meteo",
    ) -> str:
        period = f"{start_date.strftime('%b %d')} - {end_date.strftime('%b %d, %Y')}"
        src = f"[{data_source}]"
        if is_flag:
            return (
                f"Weather infeasibility detected {src}. "
                f"{heavy_rain_days} of {total_days} claimed execution days "
                f"({infeasibility_ratio:.0%}) recorded >{threshold}mm daily rainfall - "
                f"inconsistent with {work_type} operations. "
                f"Claimed period: {period}."
            )
        return (
            f"Weather conditions during claimed period ({period}) are "
            f"consistent with {work_type} operations {src}. "
            f"{heavy_rain_days}/{total_days} days exceeded {threshold}mm threshold "
            f"({infeasibility_ratio:.0%})."
        )

    def score(self, result: WeatherCheckResult) -> float:
        """Convert result to 0–1 anomaly score."""
        if result.rain_threshold_mm == 0:
            return 0.0
        return min(1.0, result.infeasibility_ratio * 1.5)
