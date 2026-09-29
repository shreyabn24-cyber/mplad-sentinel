"""Turn a feature frame into one stored evidence record per work.

The catalog in ``shared/anomaly_catalog.json`` defines the rules;
``ml.catalog`` evaluates them. This module is the join between the two and the
database: it produces the ``evidence_chain`` payload that ``RiskScore`` stores,
with the trigger value and reason recorded for every match.

Why the evidence chain is shaped this way
----------------------------------------
The old chain was keyed by seven signal names with a ``{"score": 0.0-1.0}``
payload, and the anomaly router decided a signal was active by testing
``score >= 0.3``. Six of the seven signals cannot be computed from the open
feed, so their columns sit at their 0.0 default and are indistinguishable from a
genuine measured zero. A reviewer could not tell which numbers had been measured
and which were placeholders, and every flag reported a score with no value
behind it.

Each entry here instead records:

* ``rule_id`` — the catalog rule, so its meaning is looked up rather than stored
* ``status`` — ``matched``, ``not_matched`` or ``not_evaluated``
* ``trigger_value`` and ``trigger_field`` — what was measured
* ``comparator`` — the test the value failed or passed

``not_evaluated`` is stored explicitly rather than omitted. A rule that could not
run is not a rule that passed, and the difference is invisible once the row is
in the database.
"""

from __future__ import annotations

from typing import Any, Iterable

from ml.catalog import (
    evaluate_row,
    load_catalog,
    not_computed,
    rules,
    split_evidence_chain,
)

# Only these two scores can be produced from the open feed. Both are Optional on
# the model so an absent score reads as "not computed" rather than 0.0.
AVAILABLE_SIGNAL_COLUMNS = ("isolation_score", "composite_score")

TIER_BAND_NOTE = (
    "A band is assigned only to a work that matched at least one ranking rule. "
    "A work with no match has no band, which is different from a band of L1: "
    "L1 means a rule fired, and no band means none did."
)


def build_evidence_chain(features: dict[str, Any]) -> dict[str, Any]:
    """The evidence chain for one work, keyed by catalog rule id.

    ``not_matched`` entries are stored too. The chain is the record of what was
    evaluated, and a chain holding only matches cannot distinguish a work that
    was checked and passed from a work that was never checked.
    """
    chain: dict[str, Any] = {}
    for match in evaluate_row(features):
        entry: dict[str, Any] = {"status": match["status"]}
        if match["status"] == "not_evaluated":
            entry["reason"] = match["reason"]
        else:
            entry["trigger_value"] = match.get("trigger_value")
            entry["trigger_field"] = match.get("trigger_field")
            entry["trigger_format"] = match.get("trigger_format")
            entry["comparator"] = match.get("comparator")
        chain[match["rule_id"]] = entry
    return chain


def build_work_evidence(feature_frame) -> list[dict[str, Any]]:
    """Build an evidence chain for every row of a feature frame.

    Returns one record per work, carrying the identifier, the chain, the
    measured score, the rules that count towards review candidacy, and the
    analyses that could not run at all.
    """
    not_computed_ids = [e["id"] for e in not_computed()]
    out: list[dict[str, Any]] = []
    for _, row in feature_frame.iterrows():
        features = {k: row[k] for k in feature_frame.columns}
        work_id = features.get("work_id") or features.get("upstream_row")
        chain = build_evidence_chain(features)
        matched, context, unevaluated = split_evidence_chain(chain)

        score = features.get("anomaly_score")
        score = float(score) if score is not None and score == score else None
        composite = None if score is None else round(score * 100, 1)

        out.append(
            {
                "work_id": work_id,
                "isolation_score": None if score is None else round(score, 4),
                "composite_score": composite,
                "confidence_tier": tier_band(composite) if matched else None,
                "evidence_chain": chain,
                "matched_rule_ids": [m["rule_id"] for m in matched],
                "context_rule_ids": [c["rule_id"] for c in context],
                "unevaluated_rule_ids": [u["rule_id"] for u in unevaluated],
                "not_computed": not_computed_ids,
                "is_review_candidate": bool(matched),
            }
        )
    return out


# Band edges. These are ranking bands over the normalised model output, not
# thresholds validated against known cases: no labelled sample exists to fit
# them. L1 starts at 30 because a band that starts at 0 files almost the whole
# feed as flagged, which is what the previous unconditional assignment did.
TIER_EDGES = {"L1": 30.0, "L2": 55.0, "L3": 75.0}


def tier_band(composite_score: float | None) -> str | None:
    """The band a composite score falls in, or None when unscored."""
    if composite_score is None or composite_score != composite_score:
        return None
    if composite_score >= TIER_EDGES["L3"]:
        return "L3"
    if composite_score >= TIER_EDGES["L2"]:
        return "L2"
    if composite_score >= TIER_EDGES["L1"]:
        return "L1"
    return None


def score_bands(records: Iterable[dict[str, Any]]) -> dict[str, int]:
    """Count works per band, with unscored and unflagged works counted separately.

    A tier is only assigned to a work that matched a rule. The previous code
    defaulted a missing tier to "L1", which filed every unscored record into the
    lowest flagged band, and the anomaly list filtered on ``tier in (L1,L2,L3)``,
    so an unflagged work could be listed as an anomaly.
    """
    bands = {"L1": 0, "L2": 0, "L3": 0, "unflagged": 0, "unscored": 0}
    for r in records:
        tier = r.get("confidence_tier")
        if tier in bands:
            bands[tier] += 1
        elif r.get("composite_score") is None:
            bands["unscored"] += 1
        else:
            bands["unflagged"] += 1
    return bands


def summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate counts for the training manifest and the evaluation report."""
    bands = score_bands(records)

    per_rule: dict[str, int] = {r["id"]: 0 for r in rules()}
    per_context_rule: dict[str, int] = {r["id"]: 0 for r in rules()}
    unevaluated: dict[str, int] = {r["id"]: 0 for r in rules()}
    for rec in records:
        for rid in rec["matched_rule_ids"]:
            per_rule[rid] += 1
        for rid in rec["context_rule_ids"]:
            per_context_rule[rid] += 1
        for rid in rec["unevaluated_rule_ids"]:
            unevaluated[rid] += 1

    total = len(records) or 1
    return {
        "works": len(records),
        "review_candidates": sum(1 for r in records if r["is_review_candidate"]),
        "tier_bands": bands,
        "tier_band_note": TIER_BAND_NOTE,
        "tier_edges": TIER_EDGES,
        "matched_by_rule": {
            rid: {"count": n, "share": round(n / total, 4)} for rid, n in per_rule.items()
        },
        "context_by_rule": {
            rid: {"count": n, "share": round(n / total, 4)}
            for rid, n in per_context_rule.items()
        },
        "unevaluated_by_rule": {
            rid: {"count": n, "share": round(n / total, 4)}
            for rid, n in unevaluated.items()
        },
        "not_computed": [
            {
                "id": e["id"],
                "title": e["title"],
                "reason": e["reason"],
                "user_facing_text": e["user_facing_text"],
            }
            for e in not_computed()
        ],
        "catalog_schema_version": load_catalog()["$schema_version"],
    }
