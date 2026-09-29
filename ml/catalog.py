"""Canonical anomaly catalog: the single source of truth for what can be flagged.

Every rule the system can evaluate lives in ``shared/anomaly_catalog.json`` and
is defined by its data, not by prose. The API serves that file, the frontend
renders from it, and the scoring pipeline evaluates the ``test`` block of each
rule, so a rule cannot be described one way in the API and another in the UI.

This module loads the catalog, applies the tests to a feature frame, and
records for every match the value that triggered it. It deliberately does not
rank, weight or adjudicate: a rule match is a prompt for a human to look at a
record, and nothing more. See ``interpretation_contract`` in the catalog for the
wording the API and UI must use.

Analyses that cannot run are listed in the catalog's ``not_computed`` block
with the reason, and are reported as not computed. They are never silently
omitted, because an absent check reads as a clean one.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

CATALOG_PATH = Path(__file__).resolve().parent.parent / "shared" / "anomaly_catalog.json"

VALID_STATUSES = {"COMPUTED", "NOT_COMPUTED"}
VALID_OPS = {">=", "<=", "=="}


class CatalogError(ValueError):
    """The catalog on disk is not internally consistent."""


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    """Parse and validate the catalog. Cached; the file is read once per process."""
    if not CATALOG_PATH.exists():
        raise CatalogError(f"anomaly catalog not found at {CATALOG_PATH}")
    try:
        cat = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - malformed file
        raise CatalogError(f"anomaly catalog is not valid JSON: {exc}") from exc

    _validate(cat)
    return cat


def _validate(cat: dict[str, Any]) -> None:
    seen: set[str] = set()
    for rule in cat.get("rules", []):
        rid = rule.get("id")
        if not rid:
            raise CatalogError("a rule is missing its id")
        if rid in seen:
            raise CatalogError(f"duplicate rule id: {rid}")
        seen.add(rid)
        if rule.get("status") != "COMPUTED":
            raise CatalogError(
                f"{rid}: a rule in the rules block must be status COMPUTED. "
                "An analysis that cannot run belongs in not_computed, so the API "
                "can say why rather than the rule being absent."
            )
        test = rule.get("test")
        if not test:
            raise CatalogError(f"{rid}: no test block, so no trigger value can be reported")
        if test.get("op") not in VALID_OPS:
            raise CatalogError(f"{rid}: unsupported operator {test.get('op')!r}")
        if test.get("format") not in cat.get("trigger_value_formats", {}):
            raise CatalogError(f"{rid}: unknown trigger value format {test.get('format')!r}")
        # A rule that reports a value must report the value it tested, or the
        # trigger shown to a reviewer is not the trigger that fired.
        if rule.get("value_field") != test.get("feature"):
            raise CatalogError(
                f"{rid}: value_field {rule.get('value_field')!r} does not match the "
                f"tested feature {test.get('feature')!r}"
            )
        if "means" not in rule or "does_not_mean" not in rule:
            raise CatalogError(f"{rid}: must state both what a match means and what it does not")

    for entry in cat.get("not_computed", []):
        if entry.get("status") != "NOT_COMPUTED":
            raise CatalogError(f"{entry.get('id')}: not_computed entries must say so")
        for field in ("reason", "user_facing_text", "what_it_would_need"):
            if not entry.get(field):
                raise CatalogError(f"{entry.get('id')}: not_computed entry needs {field}")


def rules() -> list[dict[str, Any]]:
    return load_catalog()["rules"]


def computed_rule_ids() -> list[str]:
    return [r["id"] for r in rules()]


def not_computed() -> list[dict[str, Any]]:
    return load_catalog()["not_computed"]


def rule_by_id(rule_id: str) -> dict[str, Any] | None:
    for r in rules():
        if r["id"] == rule_id:
            return r
    return None


def vocabulary() -> dict[str, str]:
    return load_catalog().get("vocabulary", {})


def interpretation_contract() -> dict[str, str]:
    return load_catalog().get("interpretation_contract", {})


def _as_number(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _holds(op: str, actual: float, expected: float) -> bool:
    if op == ">=":
        return actual >= expected
    if op == "<=":
        return actual <= expected
    return actual == expected


def evaluate_row(features: dict[str, Any]) -> list[dict[str, Any]]:
    """Evaluate every computed rule against one feature row.

    Returns a list of matches, each carrying the value that fired. A rule whose
    feature is missing from the row is reported as ``not_evaluated`` rather than
    dropped, so a gap in the feature frame cannot read as a clean record.
    """
    matches: list[dict[str, Any]] = []
    for rule in rules():
        test = rule["test"]
        raw = features.get(test["feature"])
        actual = _as_number(raw)

        if actual is None:
            matches.append(
                {
                    "rule_id": rule["id"],
                    "status": "not_evaluated",
                    "reason": f"{test['feature']} was absent or non-numeric for this record",
                }
            )
            continue

        if _holds(test["op"], actual, float(test["value"])):
            matches.append(
                {
                    "rule_id": rule["id"],
                    "status": "matched",
                    "trigger_value": round(actual, 4),
                    "trigger_field": test["feature"],
                    "trigger_format": test["format"],
                    "comparator": f"{test['op']} {test['value']}",
                }
            )
        else:
            matches.append(
                {
                    "rule_id": rule["id"],
                    "status": "not_matched",
                    "trigger_value": round(actual, 4),
                    "trigger_field": test["feature"],
                    "comparator": f"{test['op']} {test['value']}",
                }
            )
    return matches


def review_matches(matches: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """The matches that count towards review candidacy.

    Rules marked ``ranking_use: false`` are excluded. They remain in the catalog
    and in the per-work match list, so nothing is hidden; they simply do not make
    a work a review candidate, because on this feed they match most rows.
    """
    by_id = {r["id"]: r for r in rules()}
    out = []
    for m in matches:
        if m.get("status") != "matched":
            continue
        rule = by_id.get(m["rule_id"], {})
        if not rule.get("ranking_use", True):
            continue
        out.append(m)
    return out


def unevaluated_reasons(matches: Iterable[dict[str, Any]]) -> list[str]:
    """Human-readable notes for rules that could not be evaluated for a record."""
    return [m["reason"] for m in matches if m.get("status") == "not_evaluated"]


def _rule_entry(rule_id: str, detail: dict[str, Any]) -> dict[str, Any]:
    """One API-facing match record, with its rule text joined in from the catalog.

    The stored detail carries only what the scoring pass measured: the value and
    the comparator. The meaning of that value lives in the catalog, so it is
    joined here rather than duplicated into the database. That keeps the
    explanation correct if a rule is ever reworded, and means a stored row can
    never present a stale or invented description.
    """
    rule = rule_by_id(rule_id) or {}
    return {
        "rule_id": rule_id,
        "title": rule.get("title"),
        "category": rule.get("category"),
        "trigger_value": detail.get("trigger_value"),
        "trigger_field": detail.get("trigger_field"),
        "trigger_format": detail.get("trigger_format"),
        "comparator": detail.get("comparator"),
        "means": rule.get("means"),
        "does_not_mean": rule.get("does_not_mean"),
    }


def split_evidence_chain(
    evidence_chain: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Split a stored evidence chain into (matched, context, unevaluated).

    ``matched`` are the rules that count towards review candidacy. ``context``
    are rules that matched but are non-discriminative on this feed, so they
    cannot justify a review on their own. ``unevaluated`` are rules that could
    not be evaluated at all, which is reported rather than omitted because an
    absent check reads as a passed one.

    An entry with no rule in the catalog is returned in ``unevaluated`` with a
    reason naming the unknown id, so a stored row referring to a rule that has
    since been removed is visible instead of silently dropped.
    """
    matched: list[dict[str, Any]] = []
    context: list[dict[str, Any]] = []
    unevaluated: list[dict[str, Any]] = []

    if not isinstance(evidence_chain, dict) or not evidence_chain:
        return matched, context, unevaluated

    for rule_id, detail in evidence_chain.items():
        if not isinstance(detail, dict):
            unevaluated.append(
                {
                    "rule_id": rule_id,
                    "status": "not_evaluated",
                    "reason": "the stored rule record is not readable",
                }
            )
            continue

        if detail.get("status") == "not_evaluated":
            unevaluated.append(
                {
                    "rule_id": rule_id,
                    "status": "not_evaluated",
                    "reason": detail.get("reason")
                    or "this rule could not be evaluated for this work",
                }
            )
            continue

        if detail.get("status") != "matched":
            continue

        rule = rule_by_id(rule_id)
        if rule is None:
            unevaluated.append(
                {
                    "rule_id": rule_id,
                    "status": "not_evaluated",
                    "reason": (
                        f"{rule_id} is stored against this work but is not in the "
                        "current catalog, so it cannot be explained"
                    ),
                }
            )
            continue

        if rule.get("ranking_use", True):
            matched.append(_rule_entry(rule_id, detail))
        else:
            context.append(_rule_entry(rule_id, detail))

    return matched, context, unevaluated


def evaluate_frame(feature_frame) -> list[dict[str, Any]]:
    """Evaluate every rule for every row of a pandas DataFrame.

    Returns one dict per row, each with the work identifier, the per-rule
    matches, the subset that counts for ranking, and the not-computed analyses
    that were reported alongside them.
    """
    columns = set(feature_frame.columns)
    results: list[dict[str, Any]] = []
    for _, row in feature_frame.iterrows():
        features = {k: row[k] for k in columns}
        work_id = features.get("work_id") or features.get("upstream_row")
        matches = evaluate_row(features)
        results.append(
            {
                "work_id": work_id,
                "matches": matches,
                "review_matches": review_matches(matches),
                "not_evaluated": unevaluated_reasons(matches),
                "not_computed": [e["id"] for e in not_computed()],
            }
        )
    return results
