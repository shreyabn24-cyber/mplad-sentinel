"""Tests for the canonical anomaly catalog and the rule evaluator.

The catalog is what the API serves and the UI renders, so a rule that is
described in prose but not testable, or testable but not described, is a defect
this suite is meant to catch.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from ml.catalog import (  # noqa: E402
    CATALOG_PATH,
    CatalogError,
    computed_rule_ids,
    evaluate_row,
    load_catalog,
    not_computed,
    review_matches,
    rules,
    vocabulary,
)


# ── catalog integrity ───────────────────────────────────────────────────────


def test_catalog_exists_and_parses():
    cat = load_catalog()
    assert cat["rules"], "catalog has no rules"
    assert cat["not_computed"], "catalog must record the analyses that cannot run"


def test_every_computed_rule_has_a_triggerable_test():
    for rule in rules():
        test = rule["test"]
        assert test["feature"], f"{rule['id']} has no feature"
        assert test["op"] in {">=", "<=", "=="}
        assert isinstance(test["value"], (int, float))
        assert rule["value_field"] == test["feature"]


def test_rule_ids_are_unique():
    ids = [r["id"] for r in rules()]
    assert len(ids) == len(set(ids))


def test_every_rule_states_meaning_and_limit():
    for rule in rules():
        assert rule["means"].strip(), f"{rule['id']} does not say what a match means"
        assert rule["does_not_mean"].strip(), f"{rule['id']} does not say what it does not mean"


def test_not_computed_entries_explain_themselves():
    for entry in not_computed():
        assert entry["reason"].strip()
        assert entry["user_facing_text"].strip()
        assert entry["what_it_would_need"].strip()
        assert entry["id"] not in computed_rule_ids()


def test_rule_features_are_real_features_or_documented():
    """A rule must read a column the feature engineering actually produces.

    Otherwise a rule silently never fires, or fires on a column no longer built.
    """
    from ml.features.real_features import REAL_FEATURE_COLUMNS, engineer_real_features

    real = set(REAL_FEATURE_COLUMNS) | {"anomaly_score", "work_id", "upstream_row"}
    for rule in rules():
        assert rule["test"]["feature"] in real, (
            f"{rule['id']} tests {rule['test']['feature']!r}, which is not a real feature"
        )


def test_rules_present_in_the_stale_frontend_registry_are_gone():
    """The fabricated signal names must not reappear as catalog rules.

    ``frontend/lib/anomalyReasons.ts`` described satellite spectral deltas, IMD
    rainfall, GSTIN compliance, contractor graphs and cross-scheme duplicates with
    hardcoded telemetry. None of that is computed. This guards the specific
    fabricated keys, so a future edit cannot quietly reintroduce them as
    apparently-computed rules.
    """
    fabricated = {
        "satellite_score",
        "weather_score",
        "gstin_score",
        "graph_score",
        "cross_scheme_score",
        "citizen_score",
        "vegetation_loss_absent",
        "flash_flood_submergence",
    }
    catalog_ids = set(computed_rule_ids()) | {e["id"] for e in not_computed()}
    assert not (fabricated & catalog_ids)


def test_vocabulary_freezes_unsupported_wording():
    """The vocabulary block is where the banned terms are defined."""
    v = vocabulary()
    assert "flag" in v
    assert "not computed" in v
    assert "review candidate" in v
    assert "score band" in v


# ── rule evaluation ─────────────────────────────────────────────────────────


def _row(**over):
    base = {
        "amount_zscore_state_type": 0.1,
        "amount_zscore_constituency_type": 0.1,
        "amount_vs_peer_median": 1.0,
        "mp_amount_zscore": 0.0,
        "mp_unsanctioned_share": 0.9,
        "sanctioned_without_ida_approval": 0,
        "ida_rejected": 0,
        "ida_pending": 0,
        "days_to_nearest_election": 900.0,
        "status_unsanctioned": 0,
        "agency_unidentified": 0,
        "description_uninformative": 0,
        "geography_unidentified": 0,
        "has_coordinate": 1,
        "anomaly_score": 0.1,
    }
    base.update(over)
    return base


def test_ordinary_record_matches_only_context_rules():
    matches = evaluate_row(_row())
    matched = {m["rule_id"] for m in matches if m["status"] == "matched"}
    # The default row is unsanctioned-pending-free, coordinate-bearing and small,
    # so nothing discriminative should fire.
    assert "AMOUNT_OUTLIER_PEER_STATE" not in matched
    assert "NO_COORDINATE" not in matched


def test_match_reports_the_value_that_fired():
    matches = evaluate_row(_row(amount_zscore_state_type=3.75))
    hit = next(m for m in matches if m["rule_id"] == "AMOUNT_OUTLIER_PEER_STATE")
    assert hit["status"] == "matched"
    assert hit["trigger_value"] == 3.75
    assert hit["trigger_field"] == "amount_zscore_state_type"
    assert "3.75" in hit["comparator"] or "2.0" in hit["comparator"]


def test_missing_feature_is_not_evaluated_not_clean():
    """A feature that is absent must never be reported as a pass."""
    row = _row()
    del row["has_coordinate"]
    matches = evaluate_row(row)
    hit = next(m for m in matches if m["rule_id"] == "NO_COORDINATE")
    assert hit["status"] == "not_evaluated"
    assert "absent" in hit["reason"]


def test_non_numeric_feature_is_not_evaluated():
    matches = evaluate_row(_row(days_to_nearest_election="unknown"))
    hit = next(m for m in matches if m["rule_id"] == "RECOMMENDATION_NEAR_ELECTION")
    assert hit["status"] == "not_evaluated"


def test_threshold_boundary_is_inclusive():
    """A value exactly at the threshold is a match, and this is stated."""
    matches = evaluate_row(_row(amount_zscore_state_type=2.0))
    hit = next(m for m in matches if m["rule_id"] == "AMOUNT_OUTLIER_PEER_STATE")
    assert hit["status"] == "matched"


def test_ranking_use_excludes_context_rules_but_keeps_them_visible():
    """Non-discriminative rules are dropped from candidacy, not deleted.

    On the real feed 84% of rows are unsanctioned, so counting that rule would
    rank works by being ordinary. The match must still be reported.
    """
    matches = evaluate_row(_row(status_unsanctioned=1, description_uninformative=1))
    matched = {m["rule_id"] for m in matches if m["status"] == "matched"}
    assert "STATUS_UNSANCTIONED" in matched

    ranked = {m["rule_id"] for m in review_matches(matches)}
    assert "STATUS_UNSANCTIONED" not in ranked
    assert "DESCRIPTION_UNINFORMATIVE" not in ranked


def test_candidacy_is_empty_for_an_ordinary_record():
    matches = evaluate_row(_row())
    assert review_matches(matches) == []


def test_a_work_with_only_context_rules_is_not_a_review_candidate():
    matches = evaluate_row(_row(status_unsanctioned=1, ida_pending=1))
    assert review_matches(matches) == []


def test_not_computed_analyses_are_reported_alongside_matches():
    """Not-computed analyses are attached to every record, not omitted."""
    from ml.catalog import evaluate_frame

    frame = pd.DataFrame([{**_row(), "work_id": "MPLAD-abc"}])
    results = evaluate_frame(frame)
    assert len(results) == 1
    assert results[0]["work_id"] == "MPLAD-abc"
    assert "SATELLITE_NDBI" in results[0]["not_computed"]
    assert "CONTRACTOR_CARTEL" in results[0]["not_computed"]


# ── validation guards ───────────────────────────────────────────────────────


def test_validation_rejects_a_rule_that_cannot_report_a_trigger(monkeypatch):
    cat = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    cat["rules"][0].pop("test")
    monkeypatch.setattr("ml.catalog.CATALOG_PATH", CATALOG_PATH)
    import ml.catalog as catalog_mod

    original = catalog_mod.load_catalog

    def _load():
        catalog_mod._validate(cat)
        return cat

    # Exercise the validator directly: the cached loader would not re-read.
    with pytest.raises(CatalogError, match="no test block"):
        catalog_mod._validate(cat)
    assert original is load_catalog


def test_validation_rejects_value_field_that_is_not_the_tested_feature():
    cat = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    cat["rules"][0]["value_field"] = "some_other_column"
    import ml.catalog as catalog_mod

    with pytest.raises(CatalogError, match="does not match the tested feature"):
        catalog_mod._validate(cat)


def test_validation_rejects_an_uncomputable_rule_in_the_rules_block():
    cat = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    cat["rules"][0]["status"] = "NOT_COMPUTED"
    import ml.catalog as catalog_mod

    with pytest.raises(CatalogError, match="belongs in not_computed"):
        catalog_mod._validate(cat)


def test_validation_rejects_a_rule_missing_its_limits():
    cat = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    cat["rules"][0].pop("does_not_mean")
    import ml.catalog as catalog_mod

    with pytest.raises(CatalogError, match="what a match means and what it does not"):
        catalog_mod._validate(cat)
