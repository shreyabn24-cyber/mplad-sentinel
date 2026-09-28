"""
MPLADS Sentinel — Audit Note Generator (Gemini API)
====================================================
Generates structured draft audit notes for L2/L3 anomalies.
"""

import json
from datetime import datetime
from typing import Any, Optional

from config import settings

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = bool(settings.GEMINI_API_KEY)
    if GEMINI_AVAILABLE:
        genai.configure(api_key=settings.GEMINI_API_KEY)
except ImportError:
    GEMINI_AVAILABLE = False


AUDIT_NOTE_PROMPT_TEMPLATE = """
You are an AI assistant helping qualified government auditors review flagged MPLADS scheme works.
Generate a professional DRAFT AUDIT NOTE based on the anomaly signals below.

IMPORTANT:
- Use neutral, professional language
- Never use the words "fraud", "corrupt", or "criminal"
- Always say "pattern requiring review" or "anomaly detected"
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
- Risk Score: {risk_score}/100
- Confidence Tier: {confidence_tier}

ANOMALY SIGNALS:
{signals_text}

Generate a structured draft audit note with:
1. Work identification
2. Anomaly summary (each signal with its evidence)
3. Recommended audit actions
4. Disclaimer

Keep the note under 400 words. Be precise and factual.
"""


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
        now = datetime.utcnow().strftime("%d %B %Y")

        return f"""DRAFT AUDIT NOTE — Requires Human Verification Before Use
Generated: {now} | System: MPLADS Sentinel v1.0.0 | Model: Template (Gemini unavailable)
{'='*70}

SUBJECT: Review of MPLADS Work — {work_id}
CLASSIFICATION: {tier} High-Confidence Anomaly (Risk Score: {score:.0f}/100)

1. WORK IDENTIFICATION
   Work ID:      {work_id}
   Description:  {work_details.get('work_description', 'N/A')[:100]}
   Amount:       ₹{amount/100000:.2f} Lakhs
   Location:     {work_details.get('district_name', 'N/A')}, {work_details.get('state_code', 'N/A')}
   Work Type:    {work_details.get('work_type', 'N/A')}
   Sanction:     {work_details.get('sanction_date', 'N/A')}
   Completion:   {work_details.get('completion_date', 'N/A')}

2. ANOMALY SIGNALS DETECTED
{signals_text}

3. RECOMMENDED AUDIT ACTIONS
   □ Physical site inspection with GPS-tagged photo documentation
   □ Cross-reference completion certificate with field evidence
   □ Verify contractor GSTIN status at time of payment
   □ Obtain certified copies of measurement books and bills
   □ Interview implementing agency field engineers
   □ Review satellite imagery timestamps against claim dates

4. DISCLAIMER
   ⚠️ This note is AI-generated and presents patterns for expert review only.
   It does not constitute a finding of irregularity or wrongdoing.
   All determinations must be made by a qualified audit officer following
   standard CAG audit procedures. Model version: v1.0.0 | Data as of: {now}
"""

    def _format_signals(self, evidence_chain: dict, risk_score_data: dict) -> str:
        signal_labels = {
            'isolation_score':    'Cost/Timeline Anomaly',
            'satellite_score':    'Satellite Change Detection',
            'weather_score':      'Weather Feasibility',
            'gstin_score':        'GST Compliance',
            'graph_score':        'Contractor Network Risk',
            'cross_scheme_score': 'Cross-Scheme Duplicate Funding',
            'citizen_score':      'Citizen Ground Reports',
        }

        lines = []
        for signal, label in signal_labels.items():
            score = risk_score_data.get(signal, 0.0)
            if score >= 0.30:
                evidence = evidence_chain.get(signal, {})
                detail = evidence.get('details', f'Score: {score:.0%}')
                lines.append(f"   [{score:.0%}] {label}: {detail}")

        return '\n'.join(lines) if lines else "   No significant signals above threshold."


audit_note_service = AuditNoteService()
