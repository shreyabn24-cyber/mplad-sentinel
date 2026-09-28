"""
Real-data feature engineering
=============================
Builds ML features from fields that the genuine MPLADS feed actually contains.

Scope discipline
----------------
The verified work feed (data/fetch_real_works.py) supplies:

    mp_name, house, constituency, state_name, implementing_agency,
    work_description, category, city, ward, block, village,
    recommended_date, sanction_amount, ida_approval, status,
    reported_lat, reported_lon, coordinate_precision, contractor_gstin, data_as_on

It does NOT supply district codes, release or expenditure amounts, completion
dates, work quantities, or contractor GSTINs. Every feature here is derived
only from the columns above. A feature that cannot be computed honestly is
omitted rather than filled with a placeholder, because a zero-filled proxy
would let the model learn a relationship that does not exist in the data.

Each feature is a within-peer-group comparison (same state and same work
category, or same MP), so a value is meaningful relative to comparable works
rather than an absolute claim about one project.
"""

from __future__ import annotations

import re
import numpy as np
import pandas as pd

# General elections. Sanction/recommendation clustering near these dates is a
# recognised pattern in MPLADS reporting.
ELECTION_DATES = [
    pd.Timestamp("2019-05-23"),
    pd.Timestamp("2024-05-04"),
]

# Scheme vocabulary. MPLADS work descriptions are free text written by
# district authorities, so category is derived from keywords with an explicit
# "Unclassified" fallback rather than being assumed.
WORK_TYPE_PATTERNS: list[tuple[str, str]] = [
    ("road", r"\broad|approach road|link road|pathway|pradhan mantri gram sadak|pmsgy|road with drainage"),
    ("drinking_water", r"drinking water|potable|hand pump|water supply|tube well|bore well|water tank|jal jeevan"),
    ("irrigation", r"irrigation|canal|check dam|water harvesting|pond|drainage|culvert|irrigation structure"),
    ("electrification", r"street light|streetlight|electrifi|transformer|power|solar|lighting of public"),
    ("health", r"health|sub.?centre|primary health|phc|dispensary|ambulance|ayush"),
    ("education", r"school|education|college|hostel|mid.?day meal|pm poshan|classroom"),
    ("sanitation", r"toilet|sanitation|garbage|waste|drainage|sewer|swachh"),
    ("housing", r"housing|house construction|pucca|ghar|building of house|pmayg"),
    ("community_building", r"community (centre|center|hall)|community building|chaupal|sarkar bhawan|community structure"),
    ("sports", r"stadium|sports|playground|ground|khel"),
    ("forest", r"afforestation|forest|plantation|van (?:mahila )?mandal"),
]
_WORK_TYPE_RE = [(name, re.compile(pat, re.I)) for name, pat in WORK_TYPE_PATTERNS]

# A description consisting only of "NA - <generic phrase>" carries no
# project-specific detail, so it cannot be reviewed on its merits.
_UNINFORMATIVE_RE = re.compile(r"^\s*NA\s*[-–:]\s*\S", re.I)

_ELECTION_WINDOW_DAYS = 180


def classify_work_type(description: str) -> str:
    """Map a free-text work description to a scheme vocabulary term."""
    text = description or ""
    for name, pattern in _WORK_TYPE_RE:
        if pattern.search(text):
            return name
    return "unclassified"


def _zscore(series: pd.Series) -> pd.Series:
    mean = series.mean()
    std = series.std()
    if pd.isna(std) or std == 0:
        return pd.Series(0.0, index=series.index)
    return (series - mean) / std


def _log_amount(series: pd.Series) -> pd.Series:
    cleaned = pd.to_numeric(series, errors="coerce").clip(lower=0).fillna(0)
    return np.log1p(cleaned)


def engineer_real_features(works_df: pd.DataFrame) -> pd.DataFrame:
    """Append ML features derived from verified real fields only."""
    df = works_df.copy()

    for col in ("recommended_date",):
        if col not in df.columns:
            df[col] = pd.NaT
        df[col] = pd.to_datetime(df[col], errors="coerce")

    df["sanction_amount"] = pd.to_numeric(df.get("sanction_amount"), errors="coerce")
    amount_known = df["sanction_amount"].notna()
    df["amount_missing"] = (~amount_known).astype(int)
    df["sanction_amount"] = df["sanction_amount"].fillna(0.0)

    if "category" not in df.columns:
        df["category"] = "Unclassified"
    df["category"] = df["category"].fillna("Unclassified").astype(str)

    if "status" not in df.columns:
        df["status"] = ""
    df["status"] = df["status"].fillna("").astype(str).str.strip()

    if "ida_approval" not in df.columns:
        df["ida_approval"] = ""
    df["ida_approval"] = df["ida_approval"].fillna("").astype(str).str.strip()

    for col in ("mp_name", "constituency", "state_name", "implementing_agency", "work_description"):
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str).str.strip()

    df["work_type"] = df["work_description"].map(classify_work_type)
    df["description_uninformative"] = (
        df["work_description"].map(lambda s: bool(_UNINFORMATIVE_RE.match(s or ""))).astype(int)
    )

    # --- amount outliers relative to comparable works -------------------
    df["amount_log"] = _log_amount(df["sanction_amount"])
    df["amount_zscore_state_type"] = (
        df.groupby(["state_name", "work_type"])["sanction_amount"].transform(_zscore)
    )
    df["amount_zscore_constituency_type"] = (
        df.groupby(["constituency", "work_type"])["sanction_amount"].transform(_zscore)
    )
    df["state_type_median_amount"] = (
        df.groupby(["state_name", "work_type"])["sanction_amount"].transform("median")
    )
    # Ratio above the peer median, clipped so one huge work cannot dominate.
    median = df["state_type_median_amount"].replace(0, np.nan)
    df["amount_vs_peer_median"] = (df["sanction_amount"] / median).clip(upper=50).fillna(1.0)

    # --- process-stage signals -----------------------------------------
    status_upper = df["status"].str.upper()
    df["status_unsanctioned"] = status_upper.isin(["UNSANCTIONED"]).astype(int)
    df["status_ongoing"] = status_upper.isin(["ONGOING"]).astype(int)
    df["status_completed"] = status_upper.isin(["COMPLETED"]).astype(int)
    df["status_sanctioned"] = status_upper.isin(["SANCTIONED"]).astype(int)
    df["status_unknown"] = (df["status"] == "").astype(int)
    # Sanctioned money on a work the IDA has not approved is a real control gap.
    df["sanctioned_without_ida_approval"] = (
        (df["status_sanctioned"] == 1)
        & df["ida_approval"].str.lower().str.contains("action pending", na=False)
    ).astype(int)
    df["ida_rejected"] = df["ida_approval"].str.lower().str.contains("rejected", na=False).astype(int)
    df["ida_pending"] = df["ida_approval"].str.lower().str.contains("pending", na=False).astype(int)

    # --- election proximity ---------------------------------------------
    def days_to_election(stamp: pd.Timestamp) -> float:
        if pd.isna(stamp):
            return np.nan
        return float(min(abs((stamp - e).days) for e in ELECTION_DATES))

    df["days_to_nearest_election"] = df["recommended_date"].map(days_to_election)
    df["in_election_window"] = (
        df["days_to_nearest_election"] <= _ELECTION_WINDOW_DAYS
    ).fillna(False).astype(int)

    # --- per-MP concentration -------------------------------------------
    mp_works = df.groupby("mp_name")["upstream_row"].transform("size") if "upstream_row" in df.columns \
        else df.groupby("mp_name")["mp_name"].transform("size")
    df["mp_total_works"] = mp_works.fillna(0)
    df["mp_unsanctioned_share"] = (
        df.groupby("mp_name")["status_unsanctioned"].transform("mean").fillna(0)
    )
    df["mp_election_window_share"] = (
        df.groupby("mp_name")["in_election_window"].transform("mean").fillna(0)
    )
    df["mp_median_amount"] = df.groupby("mp_name")["sanction_amount"].transform("median").fillna(0)
    df["mp_amount_zscore"] = (
        df.groupby("mp_name")["sanction_amount"].transform(_zscore)
    )

    # --- agency signals --------------------------------------------------
    df["agency_total_works"] = df.groupby("implementing_agency")["sanction_amount"].transform("size")
    df["agency_median_amount"] = df.groupby("implementing_agency")["sanction_amount"].transform("median").fillna(0)
    df["agency_unsanctioned_share"] = (
        df.groupby("implementing_agency")["status_unsanctioned"].transform("mean").fillna(0)
    )
    # An agency whose name is missing cannot be held to account.
    df["agency_unidentified"] = (df["implementing_agency"] == "").astype(int)

    # --- geography completeness ------------------------------------------
    place_cols = [c for c in ("city", "ward", "block", "village") if c in df.columns]
    if place_cols:
        present = pd.Series(0, index=df.index)
        for c in place_cols:
            present = present + (df[c].fillna("").astype(str).str.strip() != "").astype(int)
        df["place_fields_present"] = present
        df["geography_unidentified"] = (present == 0).astype(int)
    else:
        df["place_fields_present"] = 0
        df["geography_unidentified"] = 1

    if "reported_lat" in df.columns:
        df["has_coordinate"] = (
            pd.to_numeric(df["reported_lat"], errors="coerce").notna()
            & pd.to_numeric(df.get("reported_lon"), errors="coerce").notna()
        ).astype(int)
    else:
        df["has_coordinate"] = 0

    if "contractor_gstin" in df.columns:
        gst = df["contractor_gstin"].fillna("").astype(str).str.strip()
        df["has_contractor_gstin"] = (gst != "").astype(int)
    else:
        df["has_contractor_gstin"] = 0

    return df


REAL_FEATURE_COLUMNS: list[str] = [
    # amount outliers within peer group
    "amount_zscore_state_type",
    "amount_zscore_constituency_type",
    "amount_vs_peer_median",
    "amount_missing",
    "amount_log",
    # process stage
    "status_unsanctioned",
    "status_ongoing",
    "status_completed",
    "status_sanctioned",
    "status_unknown",
    "sanctioned_without_ida_approval",
    "ida_rejected",
    "ida_pending",
    # election proximity
    "in_election_window",
    "days_to_nearest_election",
    # MP concentration
    "mp_total_works",
    "mp_unsanctioned_share",
    "mp_election_window_share",
    "mp_amount_zscore",
    # agency
    "agency_total_works",
    "agency_unsanctioned_share",
    "agency_unidentified",
    # record quality
    "description_uninformative",
    "geography_unidentified",
    "has_coordinate",
]


def build_real_feature_matrix(df: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    """Feature matrix using only columns the real feed can populate."""
    available = [c for c in REAL_FEATURE_COLUMNS if c in df.columns]
    missing = [c for c in REAL_FEATURE_COLUMNS if c not in df.columns]
    if missing:
        print(f"  note: {len(missing)} features unavailable from this feed and omitted: {missing}")

    # A feature that is constant carries no information and destabilises the
    # scaler, so drop it rather than feed the model a zero-variance column.
    varying = [c for c in available if df[c].fillna(0).nunique() > 1]
    dropped = [c for c in available if c not in varying]
    if dropped:
        print(f"  note: dropped {len(dropped)} zero-variance features: {dropped}")

    X = df[varying].fillna(0).to_numpy(dtype=float)
    return X, varying
