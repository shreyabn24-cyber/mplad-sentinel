"""
MPLADS Sentinel — Prophet Fund Lapse Predictor
==============================================
Predicts which districts/MPs are heading toward fund lapse
using Facebook Prophet time-series forecasting.
"""

import json
import pickle
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from datetime import date, datetime, timedelta

try:
    from prophet import Prophet
    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False
    print("[Notice] Prophet not installed. Install with: pip install prophet")

MODEL_DIR = Path(__file__).parent.parent / "saved_models" / "prophet"
MODEL_DIR.mkdir(exist_ok=True, parents=True)

LAPSE_THRESHOLDS = {
    'LOW': 0.3,
    'MEDIUM': 0.5,
    'HIGH': 0.7,
    'CRITICAL': 0.85,
}


class LapsePredictor:
    """
    Per-entity (district or MP) Prophet forecaster for fund lapse prediction.
    """

    def __init__(self, entity_col: str = 'district_code'):
        self.entity_col = entity_col
        self.models: dict[str, Prophet] = {}
        self.forecasts: dict[str, pd.DataFrame] = {}
        self.is_fitted = False

    def prepare_timeseries(self, quarterly_df: pd.DataFrame, entity_id: str) -> pd.DataFrame:
        """Convert quarterly expenditure to Prophet-compatible ds/y format."""
        entity_data = quarterly_df[quarterly_df[self.entity_col] == entity_id].copy()
        entity_data = entity_data.sort_values(['fiscal_year', 'quarter'])

        records = []
        for _, row in entity_data.iterrows():
            fy = int(row['fiscal_year'])
            q = int(row['quarter'])
            # Convert quarter to approximate date (end of quarter)
            month_map = {1: 6, 2: 9, 3: 12, 4: 3}
            year_offset = {1: 0, 2: 0, 3: 0, 4: 1}
            month = month_map[q]
            year = fy + year_offset[q]
            ds = date(year, month, 30 if month in [6, 9] else (31 if month in [3] else 31))
            records.append({
                'ds': pd.Timestamp(ds),
                'y': float(row['cumulative_spent']),
            })

        return pd.DataFrame(records).dropna()

    def fit(self, quarterly_df: pd.DataFrame) -> "LapsePredictor":
        """Train Prophet models for each entity."""
        if not PROPHET_AVAILABLE:
            raise RuntimeError("Prophet not installed")

        entities = quarterly_df[self.entity_col].unique()
        print(f"Training Prophet models for {len(entities)} {self.entity_col}s...")

        for entity_id in entities:
            ts_df = self.prepare_timeseries(quarterly_df, entity_id)
            if len(ts_df) < 4:  # Need minimum data points
                continue

            model = Prophet(
                yearly_seasonality=True,
                weekly_seasonality=False,
                daily_seasonality=False,
                changepoint_prior_scale=0.1,
                seasonality_prior_scale=10.0,
            )

            try:
                model.fit(ts_df)
                self.models[entity_id] = model

                # Generate forecast to end of current fiscal year
                future = model.make_future_dataframe(periods=4, freq='Q')
                forecast = model.predict(future)
                self.forecasts[entity_id] = forecast

            except Exception as e:
                print(f"  ⚠️  Prophet failed for {entity_id}: {e}")

        self.is_fitted = True
        print(f"✓ Prophet trained for {len(self.models)} entities")
        return self

    def predict_lapse(
        self,
        entity_id: str,
        allocated_amount: float,
        current_spent: float,
        fiscal_year_end: date = None,
    ) -> dict:
        """
        Predict lapse probability and amount for a given entity.
        """
        if entity_id not in self.models:
            return {
                'entity_id': entity_id,
                'lapse_probability': 0.0,
                'projected_lapse': 0.0,
                'lapse_tier': 'LOW',
                'prophet_available': False,
            }

        fiscal_year_end = fiscal_year_end or date(date.today().year, 3, 31)
        forecast = self.forecasts[entity_id]

        # Find forecast for fiscal year end
        fy_end_ts = pd.Timestamp(fiscal_year_end)
        closest = forecast.iloc[(forecast['ds'] - fy_end_ts).abs().argsort()[:1]]

        predicted_year_end_spend = float(closest['yhat'].values[0])
        predicted_lower = float(closest['yhat_lower'].values[0])
        predicted_upper = float(closest['yhat_upper'].values[0])

        # Lapse calculation
        projected_lapse = max(0, allocated_amount - predicted_year_end_spend)
        lapse_ratio = projected_lapse / allocated_amount if allocated_amount > 0 else 0

        # Lapse probability based on ratio
        if predicted_lower > allocated_amount:
            lapse_probability = 0.05
        elif predicted_year_end_spend >= allocated_amount:
            lapse_probability = 0.15
        else:
            # Sigmoid-like mapping
            lapse_probability = min(0.99, lapse_ratio * 1.2)

        # Tier assignment
        lapse_tier = 'LOW'
        for tier, threshold in reversed(list(LAPSE_THRESHOLDS.items())):
            if lapse_probability >= threshold:
                lapse_tier = tier
                break

        return {
            'entity_id': entity_id,
            'allocated_amount': allocated_amount,
            'current_spent': current_spent,
            'predicted_year_end_spend': round(predicted_year_end_spend, 2),
            'predicted_lower': round(predicted_lower, 2),
            'predicted_upper': round(predicted_upper, 2),
            'projected_lapse': round(projected_lapse, 2),
            'lapse_probability': round(lapse_probability, 3),
            'lapse_tier': lapse_tier,
            'prophet_available': True,
            'forecast_data': forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].to_dict('records'),
        }

    def save(self, path: Optional[Path] = None) -> Path:
        path = path or MODEL_DIR / "prophet_models.pkl"
        with open(path, 'wb') as f:
            pickle.dump({
                'models': self.models,
                'forecasts': {k: v.to_dict() for k, v in self.forecasts.items()},
                'entity_col': self.entity_col,
            }, f)
        print(f"✓ Prophet models saved to {path}")
        return path

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "LapsePredictor":
        path = path or MODEL_DIR / "prophet_models.pkl"
        with open(path, 'rb') as f:
            data = pickle.load(f)
        predictor = cls(entity_col=data['entity_col'])
        predictor.models = data['models']
        predictor.forecasts = {k: pd.DataFrame(v) for k, v in data['forecasts'].items()}
        predictor.is_fitted = True
        return predictor


def build_quarterly_timeseries(works_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate actual quarterly expenditure directly from works records."""
    df = works_df.copy()
    df['date'] = pd.to_datetime(df['sanction_date'], errors='coerce')
    df = df.dropna(subset=['date'])

    def get_fy_quarter(d):
        m = d.month
        y = d.year
        if m >= 4:
            fy = y
            q = (m - 4) // 3 + 1
        else:
            fy = y - 1
            q = 4
        return fy, q

    fy_q = df['date'].apply(get_fy_quarter)
    df['fiscal_year'] = [fq[0] for fq in fy_q]
    df['quarter'] = [fq[1] for fq in fy_q]

    grouped = df.groupby(['district_code', 'mp_id', 'fiscal_year', 'quarter']).agg(
        spent_amount=('expenditure_amount', 'sum'),
        allocated_amount=('sanction_amount', 'sum'),
        works_sanctioned=('work_id', 'count'),
        works_completed=('status', lambda s: (s == 'COMPLETED').sum())
    ).reset_index()

    grouped = grouped.sort_values(['district_code', 'fiscal_year', 'quarter'])
    grouped['cumulative_spent'] = grouped.groupby('district_code')['spent_amount'].cumsum()
    return grouped


def generate_quarterly_demo_data(works_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Fallback generator or aggregator from works dataframe."""
    if works_df is not None and len(works_df) > 0:
        return build_quarterly_timeseries(works_df)
    return build_quarterly_timeseries(pd.DataFrame())
