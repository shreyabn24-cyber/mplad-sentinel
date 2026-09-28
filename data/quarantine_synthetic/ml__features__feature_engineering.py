"""
MPLADS Sentinel — Feature Engineering Module
============================================
Computes all derived ML features from normalized work records.
All features are designed to be explainable and auditable.
"""

import numpy as np
import pandas as pd
from datetime import date, datetime
from typing import Optional


ELECTION_MONTHS_BEFORE = 6  # Flag works sanctioned within 6 months of election


def engineer_all_features(
    works_df: pd.DataFrame,
    quarterly_df: Optional[pd.DataFrame] = None,
    contractors_df: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """
    Master feature engineering function.
    Returns works_df with all ML features appended.
    """
    df = works_df.copy()

    # Parse dates
    df['sanction_date'] = pd.to_datetime(df['sanction_date'])
    df['completion_date'] = pd.to_datetime(df.get('completion_date'), errors='coerce')

    df = _compute_cost_features(df)
    df = _compute_timeline_features(df)
    df = _compute_election_features(df)
    df = _compute_contractor_features(df)
    df = _compute_march_clustering_features(df)
    df = _compute_amount_per_unit(df)

    return df


def _compute_cost_features(df: pd.DataFrame) -> pd.DataFrame:
    """Z-scores within district×work_type and state×work_type groups"""

    def zscore_group(series):
        m = series.mean()
        s = series.std()
        if s == 0:
            return pd.Series(0.0, index=series.index)
        return (series - m) / s

    df['amount_log'] = np.log1p(df['sanction_amount'])

    # District-level z-score
    df['amount_zscore_district'] = df.groupby(['district_code', 'work_type'])['sanction_amount'] \
        .transform(zscore_group)

    # State-level z-score
    df['amount_zscore_state'] = df.groupby(['state_code', 'work_type'])['sanction_amount'] \
        .transform(zscore_group)

    # District median for reference
    df['district_median_amount'] = df.groupby(['district_code', 'work_type'])['sanction_amount'] \
        .transform('median')

    # Release ratio (released vs sanctioned)
    df['release_ratio'] = df['release_amount'] / df['sanction_amount'].replace(0, np.nan)

    # Expenditure ratio
    df['expenditure_ratio'] = df['expenditure_amount'] / df['sanction_amount'].replace(0, np.nan)

    return df


def _compute_timeline_features(df: pd.DataFrame) -> pd.DataFrame:
    """Timeline and completion speed features"""
    df['days_sanction_to_completion'] = (
        df['completion_date'] - df['sanction_date']
    ).dt.days

    # Z-score within work_type
    def zscore_group(series):
        m = series.mean()
        s = series.std()
        if pd.isna(m) or s == 0:
            return pd.Series(0.0, index=series.index)
        return (series - m) / s

    df['timeline_zscore'] = df.groupby('work_type')['days_sanction_to_completion'] \
        .transform(zscore_group)

    # Too-fast completion flag (< 30 days for construction)
    construction_types = ['road', 'cc_road', 'community_hall', 'school_building',
                          'health_center', 'anganwadi', 'stadium', 'library']
    df['suspiciously_fast'] = (
        df['work_type'].isin(construction_types) &
        (df['days_sanction_to_completion'] < 30)
    ).astype(int)

    return df


def _compute_election_features(df: pd.DataFrame) -> pd.DataFrame:
    """Election proximity features"""
    # General Elections: May 2019, May 2024
    election_dates = [
        pd.Timestamp('2019-05-23'),
        pd.Timestamp('2024-05-04'),
    ]

    def days_to_nearest_election(dt):
        if pd.isna(dt):
            return np.nan
        return min(abs((dt - ed).days) for ed in election_dates)

    df['days_to_nearest_election'] = df['sanction_date'].apply(days_to_nearest_election)
    df['in_election_window'] = (
        df['days_to_nearest_election'] <= ELECTION_MONTHS_BEFORE * 30
    ).astype(int)

    # Works count in election window for this MP
    df['mp_works_in_election_window'] = df.groupby('mp_id')['in_election_window'].transform('sum')

    return df


def _compute_contractor_features(df: pd.DataFrame) -> pd.DataFrame:
    """Contractor concentration and network features"""
    # Total works per contractor
    contractor_work_counts = df.groupby('contractor_gstin').size()
    df['contractor_total_works'] = df['contractor_gstin'].map(contractor_work_counts)

    # How many unique MPs this contractor worked with
    contractor_mp_counts = df.groupby('contractor_gstin')['mp_id'].nunique()
    df['contractor_mp_diversity'] = df['contractor_gstin'].map(contractor_mp_counts)

    # How many unique districts
    contractor_district_counts = df.groupby('contractor_gstin')['district_code'].nunique()
    df['contractor_district_spread'] = df['contractor_gstin'].map(contractor_district_counts)

    # Concentration: what fraction of this contractor's works come from single MP?
    def max_mp_concentration(group):
        mp_counts = group['mp_id'].value_counts()
        total = len(group)
        return mp_counts.iloc[0] / total if total > 0 else 0

    contractor_concentration = df.groupby('contractor_gstin').apply(max_mp_concentration)
    df['contractor_mp_concentration'] = df['contractor_gstin'].map(contractor_concentration)

    # MP-level contractor exclusivity
    def mp_contractor_concentration(group):
        con_counts = group['contractor_gstin'].value_counts()
        total = len(group)
        return con_counts.iloc[0] / total if total > 0 else 0

    mp_concentration = df.groupby('mp_id').apply(mp_contractor_concentration)
    df['mp_contractor_exclusivity'] = df['mp_id'].map(mp_concentration)

    return df


def _compute_march_clustering_features(df: pd.DataFrame) -> pd.DataFrame:
    """Detect suspicious year-end (March) completion clustering"""
    df['completion_month'] = df['completion_date'].dt.month
    df['completion_day'] = df['completion_date'].dt.day

    # March completions
    df['is_march_completion'] = (df['completion_month'] == 3).astype(int)

    # MP-level March completion ratio
    mp_march_ratio = df.groupby('mp_id').apply(
        lambda g: g['is_march_completion'].sum() / len(g) if len(g) > 0 else 0
    )
    df['mp_march_completion_ratio'] = df['mp_id'].map(mp_march_ratio)

    # Flag if >50% completions in March
    df['high_march_clustering'] = (df['mp_march_completion_ratio'] > 0.5).astype(int)

    return df


def _compute_amount_per_unit(df: pd.DataFrame) -> pd.DataFrame:
    """Cost per unit for comparable work types"""
    df['amount_per_unit'] = np.nan

    has_quantity = df['work_quantity'].notna() & (df['work_quantity'] > 0)
    df.loc[has_quantity, 'amount_per_unit'] = (
        df.loc[has_quantity, 'sanction_amount'] / df.loc[has_quantity, 'work_quantity']
    )

    # Z-score within work_type
    def zscore_group(series):
        m = series.mean()
        s = series.std()
        if pd.isna(m) or s == 0:
            return pd.Series(0.0, index=series.index)
        return (series - m) / s

    df['amount_per_unit_zscore'] = df.groupby('work_type')['amount_per_unit'] \
        .transform(zscore_group)

    return df


def build_feature_matrix(df: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    """
    Returns the feature matrix for ML training.
    All features are numeric and handled for NaN values.
    """
    feature_cols = [
        'amount_zscore_district',
        'amount_zscore_state',
        'amount_per_unit_zscore',
        'timeline_zscore',
        'suspiciously_fast',
        'in_election_window',
        'release_ratio',
        'expenditure_ratio',
        'contractor_mp_concentration',
        'mp_contractor_exclusivity',
        'contractor_district_spread',
        'mp_march_completion_ratio',
    ]

    # Only use columns that exist
    available = [c for c in feature_cols if c in df.columns]
    X = df[available].fillna(0).values

    return X, available
