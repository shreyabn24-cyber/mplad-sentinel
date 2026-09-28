"""
MPLADS Sentinel — Cross-Scheme Duplicate Funding Detector
==========================================================
Identifies works funded under multiple schemes for the same physical asset
(e.g., MPLADS + MGNREGA + MLALAD for the same road).

Uses fuzzy text matching + geospatial proximity + amount/timeline overlap.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Optional
import numpy as np


try:
    from rapidfuzz import fuzz
    RAPIDFUZZ_AVAILABLE = True
except ImportError:
    try:
        from fuzzywuzzy import fuzz
        RAPIDFUZZ_AVAILABLE = True
    except ImportError:
        RAPIDFUZZ_AVAILABLE = False


@dataclass
class DuplicateMatch:
    work_id_mplads: str
    work_id_other: str
    other_scheme: str
    similarity_score: float         # 0-1 composite match score
    match_basis: list[str]          # ['location', 'description', 'amount', 'timeline']
    location_score: float
    description_score: float
    amount_score: float
    timeline_score: float
    distance_m: float
    is_duplicate: bool
    evidence_text: str


class CrossSchemeDuplicateDetector:
    """
    Detects cross-scheme duplicate funding using multi-signal fuzzy matching.
    
    Matching signals:
    1. Geospatial proximity (< 500m → strong match)
    2. Description text similarity (fuzzy NLP)
    3. Amount overlap (±30% range)
    4. Timeline overlap (works active in same period)
    """

    # Weights for composite score
    WEIGHTS = {
        'location': 0.40,
        'description': 0.30,
        'amount': 0.15,
        'timeline': 0.15,
    }

    DUPLICATE_THRESHOLD = 0.75   # Score ≥ 0.75 → flag as potential duplicate

    def compute_distance_m(
        self, lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        """Haversine distance in meters."""
        R = 6371000  # Earth radius in meters
        phi1, phi2 = np.radians(lat1), np.radians(lat2)
        dphi = np.radians(lat2 - lat1)
        dlambda = np.radians(lon2 - lon1)
        a = np.sin(dphi/2)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda/2)**2
        return 2 * R * np.arcsin(np.sqrt(a))

    def location_score(self, distance_m: float) -> float:
        """Score based on distance: 0m→1.0, 500m→0.5, >2km→0.0"""
        if distance_m <= 50:
            return 1.0
        elif distance_m <= 500:
            return 1.0 - (distance_m - 50) / 950 * 0.5
        elif distance_m <= 2000:
            return 0.5 - (distance_m - 500) / 1500 * 0.5
        return 0.0

    def description_score(self, desc1: str, desc2: str) -> float:
        """Fuzzy text similarity between work descriptions."""
        if not RAPIDFUZZ_AVAILABLE:
            # Fallback: simple keyword overlap
            words1 = set(desc1.lower().split())
            words2 = set(desc2.lower().split())
            intersection = words1 & words2
            union = words1 | words2
            return len(intersection) / len(union) if union else 0.0

        # Use token_sort_ratio for word-order-invariant matching
        ratio = fuzz.token_sort_ratio(desc1.lower(), desc2.lower()) / 100.0
        partial = fuzz.partial_ratio(desc1.lower(), desc2.lower()) / 100.0
        return max(ratio, partial * 0.9)

    def amount_score(self, amount1: float, amount2: float) -> float:
        """Score based on amount similarity (within 30% → high score)."""
        if amount1 <= 0 or amount2 <= 0:
            return 0.0
        ratio = min(amount1, amount2) / max(amount1, amount2)
        if ratio >= 0.85:
            return 1.0
        elif ratio >= 0.70:
            return 0.7
        elif ratio >= 0.50:
            return 0.4
        return 0.0

    def timeline_score(
        self,
        start1: date, end1: date,
        start2: date, end2: date,
    ) -> float:
        """Score based on timeline overlap."""
        overlap_start = max(start1, start2)
        overlap_end = min(end1, end2)
        if overlap_start > overlap_end:
            return 0.0
        overlap_days = (overlap_end - overlap_start).days
        total_span = min((end1 - start1).days, (end2 - start2).days)
        if total_span <= 0:
            return 0.5
        return min(1.0, overlap_days / total_span)

    def compare(
        self,
        work_mplads: dict,
        work_other: dict,
    ) -> DuplicateMatch:
        """Compare two works and return a DuplicateMatch result."""

        # Geospatial
        dist = self.compute_distance_m(
            work_mplads.get('lat', 0), work_mplads.get('lon', 0),
            work_other.get('lat', 0), work_other.get('lon', 0),
        )
        loc_score = self.location_score(dist)

        # Description
        desc_score = self.description_score(
            work_mplads.get('description', ''),
            work_other.get('description', ''),
        )

        # Amount
        amt_score = self.amount_score(
            work_mplads.get('amount', 0),
            work_other.get('amount', 0),
        )

        # Timeline
        try:
            tl_score = self.timeline_score(
                date.fromisoformat(work_mplads['sanction_date']),
                date.fromisoformat(work_mplads.get('completion_date', '2024-03-31')),
                date.fromisoformat(work_other['sanction_date']),
                date.fromisoformat(work_other.get('completion_date', '2024-03-31')),
            )
        except Exception:
            tl_score = 0.0

        # Composite score
        composite = (
            self.WEIGHTS['location'] * loc_score +
            self.WEIGHTS['description'] * desc_score +
            self.WEIGHTS['amount'] * amt_score +
            self.WEIGHTS['timeline'] * tl_score
        )

        # Match basis (signals contributing significantly)
        basis = []
        if loc_score > 0.5: basis.append('location')
        if desc_score > 0.5: basis.append('description')
        if amt_score > 0.5: basis.append('amount')
        if tl_score > 0.5: basis.append('timeline')

        is_dup = composite >= self.DUPLICATE_THRESHOLD

        evidence_text = self._build_evidence(
            work_mplads['work_id'], work_other.get('work_id', 'UNKNOWN'),
            work_other.get('scheme', 'UNKNOWN'),
            composite, dist, desc_score, is_dup
        )

        return DuplicateMatch(
            work_id_mplads=work_mplads['work_id'],
            work_id_other=work_other.get('work_id', ''),
            other_scheme=work_other.get('scheme', 'UNKNOWN'),
            similarity_score=round(composite, 3),
            match_basis=basis,
            location_score=round(loc_score, 3),
            description_score=round(desc_score, 3),
            amount_score=round(amt_score, 3),
            timeline_score=round(tl_score, 3),
            distance_m=round(dist, 1),
            is_duplicate=is_dup,
            evidence_text=evidence_text,
        )

    def _build_evidence(self, id1, id2, scheme, score, dist, desc_sim, is_dup) -> str:
        if is_dup:
            return (
                f"⚠️ Potential duplicate funding: MPLADS work {id1} matches "
                f"{scheme} work {id2} with {score:.0%} similarity. "
                f"Physical distance: {dist:.0f}m. Description similarity: {desc_sim:.0%}. "
                f"Same physical asset may be funded under multiple schemes."
            )
        return (
            f"Low similarity ({score:.0%}) with {scheme} work {id2}. "
            f"Distance: {dist:.0f}m. Not flagged as duplicate."
        )
