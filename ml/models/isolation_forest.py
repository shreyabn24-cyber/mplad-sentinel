"""
MPLADS Sentinel — Isolation Forest Tabular Anomaly Detector
===========================================================
Detects cost outliers, timeline anomalies, and sanction pattern anomalies
using Isolation Forest (unsupervised — no labeled fraud data needed).
"""

import json
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

try:
    import mlflow
    MLFLOW_AVAILABLE = True
except ImportError:
    MLFLOW_AVAILABLE = False

MODEL_DIR = Path(__file__).parent.parent / "saved_models"
MODEL_DIR.mkdir(exist_ok=True)


class IsolationForestDetector:
    """
    Tabular anomaly detector using Isolation Forest.
    Contamination=0.05 assumes ~5% of works are anomalous.
    """

    def __init__(self, contamination: float = 0.05, n_estimators: int = 200):
        self.contamination = contamination
        self.n_estimators = n_estimators
        self.model = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=42,
            max_samples='auto',
            bootstrap=False,
        )
        self.scaler = StandardScaler()
        self.feature_cols: list[str] = []
        self.is_fitted = False

    def fit(self, df: pd.DataFrame, feature_cols: list[str]) -> "IsolationForestDetector":
        """Train the Isolation Forest on the feature matrix."""
        self.feature_cols = feature_cols
        X = df[feature_cols].fillna(0).values
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled)
        self.is_fitted = True
        print(f"✓ Isolation Forest trained on {len(df)} records, {len(feature_cols)} features")
        return self

    def score(self, df: pd.DataFrame) -> np.ndarray:
        """
        Returns anomaly scores for each record.
        Score range: -0.5 (very anomalous) to 0.5 (normal)
        We invert and normalize to 0–1 where 1 = most anomalous.
        """
        if not self.is_fitted:
            raise RuntimeError("Model not fitted. Call fit() first.")
        X = df[self.feature_cols].fillna(0).values
        X_scaled = self.scaler.transform(X)
        raw_scores = self.model.decision_function(X_scaled)
        # Invert: more negative = more anomalous → normalize to 0-1
        normalized = 1 - (raw_scores - raw_scores.min()) / (raw_scores.max() - raw_scores.min() + 1e-8)
        return normalized

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        """Returns -1 for anomalies, 1 for normal (sklearn convention)."""
        if not self.is_fitted:
            raise RuntimeError("Model not fitted. Call fit() first.")
        X = df[self.feature_cols].fillna(0).values
        X_scaled = self.scaler.transform(X)
        return self.model.predict(X_scaled)

    def explain(self, df: pd.DataFrame, top_n: int = 3) -> list[dict[str, Any]]:
        """
        Returns top contributing features for each anomaly.
        Uses feature-wise z-score contribution as approximation.
        """
        X = df[self.feature_cols].fillna(0).values
        X_scaled = self.scaler.transform(X)
        explanations = []
        for i, row in enumerate(X_scaled):
            contributions = {col: abs(float(row[j])) for j, col in enumerate(self.feature_cols)}
            top_features = sorted(contributions.items(), key=lambda x: x[1], reverse=True)[:top_n]
            raw_values = {col: float(X[i, j]) for j, col in enumerate(self.feature_cols)}
            explanations.append({
                'top_features': [
                    {
                        'feature': feat,
                        'contribution': round(contrib, 3),
                        'raw_value': round(raw_values[feat], 3),
                    }
                    for feat, contrib in top_features
                ]
            })
        return explanations

    def save(self, path: Path | None = None) -> Path:
        path = path or MODEL_DIR / "isolation_forest.pkl"
        with open(path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'scaler': self.scaler,
                'feature_cols': self.feature_cols,
                'contamination': self.contamination,
            }, f)
        print(f"✓ Isolation Forest saved to {path}")
        return path

    @classmethod
    def load(cls, path: Path | None = None) -> "IsolationForestDetector":
        path = path or MODEL_DIR / "isolation_forest.pkl"
        with open(path, 'rb') as f:
            data = pickle.load(f)
        detector = cls(contamination=data['contamination'])
        detector.model = data['model']
        detector.scaler = data['scaler']
        detector.feature_cols = data['feature_cols']
        detector.is_fitted = True
        return detector


def train_and_save(works_df: pd.DataFrame, feature_cols: list[str]) -> IsolationForestDetector:
    """Convenience function for training pipeline."""
    detector = IsolationForestDetector()
    detector.fit(works_df, feature_cols)
    detector.save()
    return detector
