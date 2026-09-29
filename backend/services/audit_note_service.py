"""
MPLADS Sentinel — Audit Note Generator (Gemini API)
====================================================
Generates structured draft audit notes for L2/L3 anomalies.
"""

import json
from datetime import datetime, timezone
from typing import Any, Optional

from config import settings
from ml_catalog_loader import load_catalog, rules as catalog_rules

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = bool(settings.GEMINI_API_KEY)
    if GEMINI_AVAILABLE:
        genai.configure(api_key=settings.GEMINI_API_KEY)
except ImportError:
    GEMINI_AVAILABLE = False


AUDIT_NOTE_PROMPT_TEMPLATE = """
You are an AI assistant helping qualified government auditors review flagged MPLADS scheme works.
Generate a professional DRAFT AUDIT NOTE based on the catalog rule matches below.

IMPORTANT:
- Use neutral, professional language
- Never use the words "fraud", "corrupt", or "criminal"
- Refer to a match as a "review signal" or a "matched rule", never as a
  "finding", "verified" or "corroborated" result
- Do not assert that an MP, agency or contractor is at fault. A match is a
  prompt to look at a record, and the record may be entirely legitimate.
- Do not mention any check the system did not perform. In particular this
  deployment reads no satellite pixels, no contractor or GSTIN data, no weather
  data and no second scheme's records, so never describe imagery analysis, a
  contractor network, a tax check or a duplicate-funding match.
- Preserve every "does not mean" line given to you. Those are the limits of what
  the measurement shows and dropping them turns a provisional signal into a
  conclusion.
- End with a mandatory disclaimer
- Format as a structured audit note

WORK DETAILS:
- Work ID: {work_id}
- Description: {work_description}
- Amount: ₹{amount_lakhs:.1f} Lakhs
- District: {district}, {state}
- Work Type: {work_type}
- Sanction Date: {sanction_date}
- Completion Date: {completion_date}
- Score band: {risk_score}/100
- Tier band: {confidence_tier}

MATCHED RULES (with the value that triggered each):
{signals_text}

Generate a structured draft audit note with:
1. Work identification
2. Which rules matched, each with its trigger value and what it does not mean
3. Recommended audit actions
4. Disclaimer

Keep the note under 400 words. Be precise and factual.
"""


def _render_value(fmt: str | None, value: Any, format_help: str) -> str:
    """Format a trigger value with the unit its catalog format implies.

    A bare number is ambiguous across formats — 1.0 is a flag, a share of works
    and a score in three different rules — so the unit is always stated.
    """
    if value is None:
        return "value unavailable"
    if fmt == "z_score":
        return f"{float(value):.2f} standard deviations above the peer-group mean"
    if fmt == "ratio":
        note = " (clipped: the true ratio is 50 or more)" if float(value) >= 50 else ""
        return f"{float(value):.1f}x the peer-group median{note}"
    if fmt == "ratio_of_works":
        return f"{float(value):.1%} of that MP's works in this feed"
    if fmt == "days":
        return f"{float(value):.0f} days from the nearest general election"
    if fmt == "score":
        return f"{float(value):.2f} on a 0-1 normalised ranking score (a rank, not a probability)"
    if fmt == "flag":
        return "condition held" if float(value) == 1 else "condition did not hold"
    return f"{value} ({format_help})" if format_help else str(value)


class AuditNoteService:
    """Generates LLM-powered draft audit notes for flagged works."""

    def __init__(self):
        self.model = None
        if GEMINI_AVAILABLE:
            self.model = genai.GenerativeModel(settings.GEMINI_MODEL)

    async def generate(
        self,
        work_id: str,
        work_details: dict[str, Any],
        risk_score_data: dict[str, Any],
        evidence_chain: dict[str, Any],
    ) -> str:
        """Generate a draft audit note. Falls back to template if Gemini unavailable."""
        signals_text = self._format_signals(evidence_chain, risk_score_data)

        if GEMINI_AVAILABLE and self.model:
            return await self._generate_with_gemini(
                work_id, work_details, risk_score_data, signals_text
            )
        else:
            return self._generate_template_note(
                work_id, work_details, risk_score_data, evidence_chain, signals_text
            )

    async def _generate_with_gemini(
        self,
        work_id: str,
        work_details: dict,
        risk_score_data: dict,
        signals_text: str,
    ) -> str:
        amount = float(work_details.get("sanction_amount", 0))
        prompt = AUDIT_NOTE_PROMPT_TEMPLATE.format(
            work_id=work_id,
            work_description=work_details.get("work_description", "N/A"),
            amount_lakhs=amount / 100000,
            district=work_details.get("district_name", "N/A"),
            state=work_details.get("state_code", "N/A"),
            work_type=work_details.get("work_type", "N/A"),
            sanction_date=work_details.get("sanction_date", "N/A"),
            completion_date=work_details.get("completion_date", "N/A"),
            risk_score=risk_score_data.get("composite_score", 0),
            confidence_tier=risk_score_data.get("confidence_tier", "N/A"),
            signals_text=signals_text,
        )

        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            return self._generate_template_note(
                work_id, work_details, risk_score_data, {}, signals_text
            )

    def _generate_template_note(
        self,
        work_id: str,
        work_details: dict,
        risk_score_data: dict,
        evidence_chain: dict,
        signals_text: str,
    ) -> str:
        """Deterministic template-based fallback."""
        amount = float(work_details.get("sanction_amount", 0))
        tier = risk_score_data.get("confidence_tier", "L2")
        score = risk_score_data.get("composite_score", 0)
        now = datetime.now(timezone.utc).strftime("%d %B %Y")

        return f"""DRAFT AUDIT NOTE — Requires Human Verification Before Use
Generated: {now} | System: MPLADS Sentinel v1.0.0 | Model: Template (Gemini unavailable)
{'='*70}

SUBJECT: Review of MPLADS Work — {work_id}
TIER BAND: {tier} (score {score:.0f}/100)

A tier band is where this record lands in a ranking model. It is not a
severity, not a legal classification, and not a statement about anyone's
conduct. The rules below are what the scoring pass actually recorded.

1. WORK IDENTIFICATION
   Work ID:      {work_id}
   Description:  {work_details.get('work_description', 'N/A')[:100]}
   Amount:       ₹{amount/100000:.2f} Lakhs
   Location:     {work_details.get('district_name', 'N/A')}, {work_details.get('state_code', 'N/A')}
   Work Type:    {work_details.get('work_type', 'N/A')}
   Sanction:     {work_details.get('sanction_date', 'N/A')}
   Completion:   {work_details.get('completion_date', 'N/A')}

2. RULES THAT MATCHED
{signals_text}

3. CHECKS THIS SYSTEM DID NOT PERFORM
   This deployment reads no satellite pixels, no contractor or GSTIN data, no
   weather records, no second scheme's asset register and no payment trail. Each
   of those checks is listed with the reason in the anomaly catalog at
   GET /api/v1/anomalies/catalog under "not_computed".
   Their absence here is not a pass, and this note must not be read as covering
   them.

4. RECOMMENDED AUDIT ACTIONS
   These are the actions a human auditor can take with the records the scheme
   actually produces. They are suggestions for the reviewing officer, not
   findings and not instructions.
   □ Physical site inspection, noting that the coordinate here is a place
     centroid for a village, block, city or constituency, not a surveyed site
   □ Obtain the sanctioned estimate, measurement book and bills from the
     implementing agency and compare them with the sanctioned amount
   □ Read the agency's approval response and the sanction date together, since
     the portal populates them independently
   □ Confirm the work's stated description and location against the agency's
     own records, since most records in this feed carry a placeholder description
   □ Check the constitution and sanction status of the work in the official
     register, which this system does not ingest

5. DISCLAIMER
   ⚠️ This note is AI-generated or template-generated and presents matched
   review rules only. It does not constitute a finding of irregularity or
   wrongdoing, and no rule here has been checked against the ground.
   All determinations must be made by a qualified audit officer following
   standard CAG audit procedures. Score band: {score}/100 ({tier}) |
   Model version: v1.0.0 | Data as of: {now}
"""

    def _format_signals(self, evidence_chain: dict, risk_score_data: dict) -> str:
        """Render the catalog rules that actually matched, with their values.

        This used to iterate a hardcoded dict of seven signal names and read a
        0-0.1 score out of ``risk_score_data``. Six of those seven signals cannot
        be produced from the open feed, so their columns are 0.0 by default and
        the block always printed "No significant signals above threshold" while
        the note body still recommended checking GSTINs and satellite imagery —
        checks this system has no data to perform.

        The evidence chain is now keyed by catalog rule id and records the value
        that triggered each match, so the note states the value a reviewer can
        actually go and look at.
        """
        if not isinstance(evidence_chain, dict) or not evidence_chain:
            return (
                "   No catalog rule is recorded against this work. That means the "
                "scoring pass stored no matches, not that the work was checked "
                "against every source and found sound."
            )

        titles = {r["id"]: r.get("title", r["id"]) for r in catalog_rules()}
        formats = load_catalog().get("trigger_value_formats", {})

        matched, unevaluated = [], []
        for rule_id, detail in evidence_chain.items():
            if not isinstance(detail, dict):
                continue
            if detail.get("status") == "not_evaluated":
                unevaluated.append(
                    f"   [not evaluated] {titles.get(rule_id, rule_id)}: "
                    f"{detail.get('reason', 'the field was unavailable')}"
                )
                continue
            if detail.get("status") != "matched":
                continue
            label = titles.get(rule_id, rule_id)
            fmt = formats.get(detail.get("trigger_format"), "")
            value = detail.get("trigger_value")
            unit = _render_value(detail.get("trigger_format"), value, fmt)
            comparator = detail.get("comparator", "")
            line = f"   [matched] {label}: {detail.get('trigger_field')} = {unit}"
            if comparator:
                line += f" (trigger: {comparator})"
            line += f"\n      means: {detail.get('means', '')}"
            line += f"\n      does not mean: {detail.get('does_not_mean', '')}"
            matched.append(line)

        lines = matched or ["   No catalog rule matched this record."]
        if unevaluated:
            lines.append("")
            lines.append(
                "   Rules that could not be evaluated for this work, so their "
                "absence is not a pass:"
            )
            lines.extend(unevaluated)

        return "\n".join(lines)


audit_note_service = AuditNoteService()
