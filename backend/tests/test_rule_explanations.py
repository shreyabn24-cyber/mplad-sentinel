"""The anomaly card and the catalog must agree, and neither may overstate.

These tests cover the API surface that replaced the hardcoded frontend registry:
the ``/anomalies/catalog`` endpoint, and the matched/context/unevaluated split
that both the anomaly list and the work detail endpoint return.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from ml.catalog import split_evidence_chain  # noqa: E402
from routers.anomalies import _build_cards  # noqa: E402
from services.audit_note_service import AuditNoteService  # noqa: E402


def _work(**over):
    base = dict(
        work_id="MPLAD-abc",
        official_work_ref="UP/2019/1",
        district_name=None,
        district_code=None,
        state_code="UP",
        constituency_name="Kannauj",
        work_type="Road",
        work_description="NA - Road construction",
        sanction_amount=1_000_000.0,
        mp_id="MP-12-034",
        sanction_date=None,
        recommended_date=None,
        completion_date=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


def _risk(evidence, score=70.0, tier="L2"):
    return SimpleNamespace(
        composite_score=score,
        confidence_tier=tier,
        evidence_chain=evidence,
    )


# ── the split ───────────────────────────────────────────────────────────────


def test_matched_rule_carries_its_value_and_its_limits():
    evidence = {
        "AMOUNT_OUTLIER_PEER_STATE": {
            "status": "matched",
            "trigger_value": 3.75,
            "trigger_field": "amount_zscore_state_type",
            "trigger_format": "z_score",
            "comparator": ">= 2.0",
        }
    }
    matched, context, unevaluated = split_evidence_chain(evidence)
    assert len(matched) == 1
    m = matched[0]
    assert m["rule_id"] == "AMOUNT_OUTLIER_PEER_STATE"
    assert m["trigger_value"] == 3.75
    assert m["trigger_field"] == "amount_zscore_state_type"
    # The limits come from the catalog, not from the stored row, so a rule
    # reworded in the catalog cannot be explained by a stale database string.
    assert m["does_not_mean"]
    assert "wrong" in m["does_not_mean"] or "cap" in m["does_not_mean"]
    assert not context and not unevaluated


def test_non_discriminative_match_is_context_not_candidacy():
    evidence = {"STATUS_UNSANCTIONED": {"status": "matched", "trigger_value": 1.0}}
    matched, context, unevaluated = split_evidence_chain(evidence)
    assert matched == []
    assert [c["rule_id"] for c in context] == ["STATUS_UNSANCTIONED"]
    assert not unevaluated


def test_unevaluated_rule_is_surfaced_not_dropped():
    evidence = {
        "NO_COORDINATE": {
            "status": "not_evaluated",
            "reason": "has_coordinate was absent for this record",
        }
    }
    matched, context, unevaluated = split_evidence_chain(evidence)
    assert matched == [] and context == []
    assert unevaluated[0]["rule_id"] == "NO_COORDINATE"
    assert "absent" in unevaluated[0]["reason"]


def test_stored_rule_missing_from_the_catalog_is_reported():
    """A row referring to a removed rule must be visible, not silently dropped."""
    evidence = {"GHOST_RULE_REMOVED_LAST_YEAR": {"status": "matched", "trigger_value": 1}}
    matched, context, unevaluated = split_evidence_chain(evidence)
    assert matched == [] and context == []
    assert "not in the current catalog" in unevaluated[0]["reason"]


def test_empty_and_absent_evidence_chain_are_all_empty():
    for value in (None, {}, "not a dict", 7):
        assert split_evidence_chain(value) == ([], [], [])


def test_not_matched_entries_are_excluded():
    evidence = {
        "AMOUNT_OUTLIER_PEER_STATE": {
            "status": "not_matched",
            "trigger_value": 0.4,
            "comparator": ">= 2.0",
        }
    }
    assert split_evidence_chain(evidence) == ([], [], [])


# ── the card ────────────────────────────────────────────────────────────────


def test_card_reports_matched_context_and_not_computed():
    evidence = {
        "AMOUNT_RATIO_PEER_MEDIAN": {
            "status": "matched",
            "trigger_value": 7.2,
            "trigger_field": "amount_vs_peer_median",
            "trigger_format": "ratio",
            "comparator": ">= 5.0",
        },
        "STATUS_UNSANCTIONED": {"status": "matched", "trigger_value": 1.0},
    }
    card = _build_cards([(_work(), _risk(evidence))], reveal_mp_identity=False)[0]

    assert [m["rule_id"] for m in card.matched_rules] == ["AMOUNT_RATIO_PEER_MEDIAN"]
    assert [c["rule_id"] for c in card.context_rules] == ["STATUS_UNSANCTIONED"]
    assert card.active_signals == ["AMOUNT_RATIO_PEER_MEDIAN"]

    # The analyses that did not run travel with the card, so their absence
    # cannot be read as a clean result.
    ids = {e["id"] for e in card.not_computed}
    assert {"SATELLITE_NDBI", "CONTRACTOR_CARTEL", "GSTIN_COMPLIANCE"} <= ids
    for entry in card.not_computed:
        assert entry["reason"] and entry["user_facing_text"]


def test_card_flags_incomplete_evaluation():
    evidence = {"NO_COORDINATE": {"status": "not_evaluated", "reason": "absent"}}
    card = _build_cards([(_work(), _risk(evidence))], reveal_mp_identity=False)[0]
    assert card.incomplete_evaluation is True
    assert card.matched_rules == []


def test_public_card_masks_mp_identity_at_every_tier():
    """Masking is uniform; only the audit-gated endpoint reveals identity."""
    for tier in ("L1", "L2", "L3"):
        card = _build_cards(
            [(_work(), _risk({}, score=90.0, tier=tier))], reveal_mp_identity=False
        )[0]
        assert card.mp_id_masked == "MP-12-***", f"tier {tier} leaked the MP identity"


def test_audit_gated_card_reveals_mp_identity():
    card = _build_cards(
        [(_work(), _risk({}, score=90.0, tier="L3"))], reveal_mp_identity=True
    )[0]
    assert card.mp_id_masked == "MP-12-034"


# ── audit note ──────────────────────────────────────────────────────────────


def test_audit_note_reports_the_trigger_value():
    svc = AuditNoteService()
    evidence = {
        "AMOUNT_OUTLIER_PEER_STATE": {
            "status": "matched",
            "trigger_value": 3.75,
            "trigger_field": "amount_zscore_state_type",
            "trigger_format": "z_score",
            "comparator": ">= 2.0",
        }
    }
    text = svc._format_signals(evidence, {})
    assert "3.75" in text
    assert "standard deviations" in text
    assert "does not mean" in text


def test_audit_note_states_unevaluated_rules():
    svc = AuditNoteService()
    evidence = {
        "NO_COORDINATE": {
            "status": "not_evaluated",
            "reason": "reported_lat was absent for this record",
        }
    }
    text = svc._format_signals(evidence, {})
    assert "not evaluated" in text
    assert "not a pass" in text


def test_audit_note_says_an_empty_chain_is_not_a_clean_record():
    """The old version printed 'no significant signals', implying a pass."""
    svc = AuditNoteService()
    text = svc._format_signals({}, {})
    assert "not that the work was checked" in text


def test_audit_note_does_not_claim_unavailable_checks():
    """A note must not describe imagery, GSTIN or duplicate-funding analysis."""
    svc = AuditNoteService()
    note = svc._generate_template_note(
        "MPLAD-abc",
        {
            "work_description": "Road construction",
            "sanction_amount": 1_000_000.0,
            "district_name": None,
            "state_code": "UP",
            "work_type": "Road",
            "sanction_date": None,
            "completion_date": None,
        },
        {"composite_score": 72.0, "confidence_tier": "L2"},
        {
            "AMOUNT_OUTLIER_PEER_STATE": {
                "status": "matched",
                "trigger_value": 3.2,
                "trigger_field": "amount_zscore_state_type",
                "trigger_format": "z_score",
                "comparator": ">= 2.0",
            }
        },
        "3.20 standard deviations",
    )
    assert "CHECKS THIS SYSTEM DID NOT PERFORM" in note
    assert "not a pass" in note
    # The old recommended-actions list told auditors to verify a GSTIN and
    # review satellite imagery, neither of which this deployment can do.
    assert "Verify contractor GSTIN" not in note
    assert "Review satellite imagery" not in note
    assert "does not constitute a finding" in note
