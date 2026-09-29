"""Backend-side access to the shared anomaly catalog.

The catalog lives in ``shared/anomaly_catalog.json`` and is owned by
``ml/catalog.py``, which evaluates it during scoring. The backend serves the same
file so the API cannot describe a different rule set than the one that ran.

``ml.catalog`` imports only the standard library at module scope (pandas is used
in ``evaluate_frame`` and imported by the caller, which already has it), so
importing it here costs nothing and there is no second parser to drift. The
loader adds only the path resolution and the lru_cache.
"""

from __future__ import annotations

from ml.catalog import (  # noqa: F401  (re-exported for the routers)
    CATALOG_PATH,
    CatalogError,
    load_catalog,
    not_computed,
    rules,
    split_evidence_chain,
)

__all__ = [
    "CATALOG_PATH",
    "CatalogError",
    "load_catalog",
    "matched_rules_for",
    "context_rules_for",
    "has_unevaluated",
    "not_computed",
    "rules",
    "split_evidence_chain",
]


def matched_rules_for(evidence_chain) -> list[dict]:
    """Catalog rules that matched and count towards review candidacy."""
    return split_evidence_chain(evidence_chain)[0]


def context_rules_for(evidence_chain) -> list[dict]:
    """Rules that matched but are non-discriminative on this feed."""
    return split_evidence_chain(evidence_chain)[1]


def has_unevaluated(evidence_chain) -> bool:
    """True when at least one rule could not be evaluated for the record."""
    return bool(split_evidence_chain(evidence_chain)[2])
