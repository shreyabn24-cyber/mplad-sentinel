"""
MPLADS Sentinel — Ensemble Risk Scorer
=======================================
Combines all model signals into a single composite Risk Score [0-100]
and assigns confidence tiers (L1/L2/L3) with legal safety enforcement.

Weights:
  satellite_score     0.25  (satellite evidence is hardest to fabricate)
  isolation_score     0.20  (cost/timeline anomaly)
  weather_score       0.15  (physical impossibility)
  gstin_score         0.15  (contractor compliance)
  graph_score         0.10  (contractor network)
  cross_scheme_score  0.10  (duplicate funding)
  citizen_score       0.05  (citizen corroboration)
"""

from dataclasses import dataclass, field
from typing import Any, Optional

# ─────────────────────────────────────────────
# Signal Weights
# ─────────────────────────────────────────────
SIGNAL_WEIGHTS = {
    'satellite_score':     0.25,
    'isolation_score':     0.20,
    'weather_score':       0.15,
    'gstin_score':         0.15,
    'graph_score':         0.10,
    'cross_scheme_score':  0.10,
    'citizen_score':       0.05,
}

# Hard-rule overrides are disabled. Each elevated the tier to L3 on a single
# signal and asserted a conclusion the evidence could not support: a satellite
# score was treated as a confirmed ghost project, a duplicate match as
# unambiguous double funding, a cancelled GSTIN as proof of a shell company.
#
# No input can currently produce a valid value for any of these signals, since
# the open MPLADS feed publishes no GSTIN, no real duplicate-detection source,
# and no calibrated satellite analysis. Leaving them active would imply a
# capability that does not exist. The original thresholds are kept below only as
# documentation of what was removed and why.
DISABLED_HARD_RULE_OVERRIDES = [
    # (signal, threshold, minimum_score_override)
    ('satellite_score',    0.80,  75.0),   # would have meant "ghost project confirmed"
    ('cross_scheme_score', 0.90,  80.0),   # would have meant "double funding confirmed"
    ('gstin_score',        0.90,  65.0),   # would have meant "shell company"
]

HARD_RULE_OVERRIDES: list[tuple[str, float, float]] = []

# Tier thresholds
TIER_THRESHOLDS = {
    'L1': (30.0, 54.9),
    'L2': (55.0, 74.9),
    'L3': (75.0, 100.0),
}

# Minimum corroborating signals required per tier
MIN_SIGNALS_PER_TIER = {
    'L1': 1,
    'L2': 2,
    'L3': 3,
}


@dataclass
class EnsembleResult:
    work_id: str
    composite_score: float              # 0–100
    confidence_tier: str                # L1, L2, L3, or None
    signal_scores: dict[str, float]     # Individual model scores
    active_signals: list[str]           # Signals above threshold
    evidence_chain: dict[str, Any]      # Full evidence from each model
    hard_rule_triggered: bool
    hard_rule_detail: Optional[str]
    mp_masked: bool                     # True for L1/L2 (legal safety)
    legal_disclaimer: str


class EnsembleScorer:
    """
    Aggregates all model signals into a final risk score with legal safety enforcement.
    """

    SIGNAL_THRESHOLD = 0.30    # Score ≥ 0.30 → signal "active"

    def score(
        self,
        work_id: str,
        signals: dict[str, float],
        evidence_chain: Optional[dict] = None,
    ) -> EnsembleResult:
        """
        Compute composite risk score and assign confidence tier.

        Args:
            work_id: Work identifier
            signals: Dict of signal_name → score (0.0–1.0)
            evidence_chain: Optional full evidence from each model
        """
        # Fill missing signals with 0
        all_signals = {k: float(signals.get(k, 0.0)) for k in SIGNAL_WEIGHTS}

        # Weighted composite score
        raw_score = sum(
            all_signals[signal] * weight
            for signal, weight in SIGNAL_WEIGHTS.items()
        )
        composite_score = min(100.0, raw_score * 100.0)

        # Active signals (above threshold)
        active_signals = [
            signal for signal, score in all_signals.items()
            if score >= self.SIGNAL_THRESHOLD
        ]

        # Hard rule overrides
        hard_rule_triggered = False
        hard_rule_detail = None
        for signal, threshold, min_score in HARD_RULE_OVERRIDES:
            if all_signals.get(signal, 0.0) >= threshold:
                if composite_score < min_score:
                    composite_score = min_score
                    hard_rule_triggered = True
                    hard_rule_detail = (
                        f"Hard rule: {signal}={all_signals[signal]:.2f} "
                        f"≥ {threshold} → score elevated to {min_score}"
                    )
                    break

        # Tier assignment (requires both score threshold AND minimum signals)
        confidence_tier = self._assign_tier(composite_score, len(active_signals))

        # Legal safety: mask MP identity in L1 and L2
        mp_masked = confidence_tier in (None, 'L1', 'L2')

        legal_disclaimer = (
            "⚠️ This flag requires human verification before any official action. "
            "This system surfaces patterns for expert review — it does not determine fraud. "
            "All final determinations must be made by qualified audit officers."
        )

        return EnsembleResult(
            work_id=work_id,
            composite_score=round(composite_score, 1),
            confidence_tier=confidence_tier,
            signal_scores={k: round(v, 4) for k, v in all_signals.items()},
            active_signals=active_signals,
            evidence_chain=evidence_chain or {},
            hard_rule_triggered=hard_rule_triggered,
            hard_rule_detail=hard_rule_detail,
            mp_masked=mp_masked,
            legal_disclaimer=legal_disclaimer,
        )

    def _assign_tier(self, score: float, n_active_signals: int) -> Optional[str]:
        """Assign tier based on score AND minimum corroborating signals."""
        for tier in ['L3', 'L2', 'L1']:
            lo, hi = TIER_THRESHOLDS[tier]
            if lo <= score <= hi:
                if n_active_signals >= MIN_SIGNALS_PER_TIER[tier]:
                    return tier
                # Score qualifies but not enough signals — downgrade
                # e.g. L3 score but only 1 signal → show as L2 if signals qualify
        # Also check downgrade scenarios
        if score >= 75.0 and n_active_signals == 2:
            return 'L2'
        if score >= 55.0 and n_active_signals == 1:
            return 'L1'
        if score >= 30.0 and n_active_signals >= 1:
            return 'L1'
        return None   # Below L1 threshold — no flag

    def build_narrative_summary(self, result: EnsembleResult, work_details: dict) -> str:
        """Generate a concise narrative summary of the anomaly for display."""
        work_desc = work_details.get('work_description', 'N/A')
        amount = work_details.get('sanction_amount', 0)
        district = work_details.get('district_name', 'N/A')

        lines = [
            f"Work: {work_desc[:80]}{'...' if len(work_desc) > 80 else ''}",
            f"District: {district} | Amount: ₹{amount/100000:.1f}L",
            f"Risk Score: {result.composite_score}/100 | Tier: {result.confidence_tier}",
            "",
            "Active Signals:",
        ]

        signal_labels = {
            'satellite_score': '🛰️ Satellite Change Detection',
            'isolation_score': '📊 Cost/Timeline Anomaly',
            'weather_score':   '🌧️ Weather Infeasibility',
            'gstin_score':     '📋 GST Non-Compliance',
            'graph_score':     '🕸️ Contractor Network Risk',
            'cross_scheme_score': '⚠️ Cross-Scheme Duplicate',
            'citizen_score':   '👥 Citizen Reports',
        }

        for signal in result.active_signals:
            score = result.signal_scores.get(signal, 0)
            label = signal_labels.get(signal, signal)
            lines.append(f"  • {label}: {score:.0%}")

        if result.hard_rule_triggered:
            lines.append(f"\n🔴 Hard Rule Triggered: {result.hard_rule_detail}")

        return '\n'.join(lines)


# ─────────────────────────────────────────────
# Convenience scoring from individual model outputs
# ─────────────────────────────────────────────

def score_work(
    work_id: str,
    isolation_score: float = 0.0,
    satellite_change: float = 0.0,
    satellite_flag: bool = False,
    weather_infeasibility_ratio: float = 0.0,
    gstin_anomaly_score: float = 0.0,
    graph_score: float = 0.0,
    cross_scheme_score: float = 0.0,
    citizen_reports: list[dict] | None = None,
    evidence_chain: dict | None = None,
) -> EnsembleResult:
    """
    High-level convenience function to score a single work.
    Called by the FastAPI risk service.
    """
    # Normalize satellite signal
    sat_score = (1.0 - satellite_change) if satellite_flag else max(0.0, 0.5 - satellite_change)

    # Citizen report score: fraction of reports saying "no construction"
    citizen_score = 0.0
    if citizen_reports:
        negative_reports = sum(1 for r in citizen_reports if not r.get('construction_visible', True))
        citizen_score = negative_reports / len(citizen_reports) if citizen_reports else 0.0

    signals = {
        'satellite_score':    min(1.0, sat_score),
        'isolation_score':    min(1.0, isolation_score),
        'weather_score':      min(1.0, weather_infeasibility_ratio * 1.5),
        'gstin_score':        min(1.0, gstin_anomaly_score),
        'graph_score':        min(1.0, graph_score),
        'cross_scheme_score': min(1.0, cross_scheme_score),
        'citizen_score':      min(1.0, citizen_score),
    }

    scorer = EnsembleScorer()
    return scorer.score(work_id, signals, evidence_chain)
