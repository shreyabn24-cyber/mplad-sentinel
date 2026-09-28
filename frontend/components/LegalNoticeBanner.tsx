import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Standing limitation notice.
 *
 * What this said before
 * --------------------
 * "Statutory Risk Intelligence Layer: This system provides probabilistic risk
 * indicators to assist qualified auditors... All findings require physical
 * ground verification under the MPLADS Guidelines (2023)." Next to it, a badge
 * reading "AUDITOR REVIEW ENFORCED" in green.
 *
 * Three problems:
 *
 *  1. "Statutory" and "MPLADS Guidelines (2023)" assert a legal instrument and
 *     an edition that this project cannot cite. The masking rule that does exist
 *     (`_mask_mp_id` in the anomalies router) is a design decision made in this
 *     codebase, described in its docstring as "a configuration decision in this
 *     deployment", not as something established by an instrument.
 *  2. "AUDITOR REVIEW ENFORCED" is a security claim rendered as a static green
 *     badge. It looks like a status indicator but reads a hardcoded string, so
 *     it was displayed identically whether or not any review control was
 *     reachable. It is not a status light and never was.
 *  3. It was not rendered anywhere (`LegalNoticeBanner` had no importer), so
 *     the copy being wrong was invisible — and the guarantee that it appeared
 *     on every page, if it had been mounted, is not something a component can
 *     promise on its own.
 *
 * It is mounted in `app/layout.tsx` now, so the limitation is actually stated on
 * every page. The badge is gone: whether review is available depends on the
 * signed-in role, and a page-level component cannot know that. The pages that
 * gate review on a role say so where the control is.
 */
export default function LegalNoticeBanner() {
  return (
    <div className="bg-slate-900/90 border-b border-amber-500/30 px-4 py-2.5 text-xs text-slate-300 flex items-center gap-2 max-w-6xl backdrop-blur-md">
      <div className="p-1 rounded bg-amber-500/10 text-amber-400 shrink-0">
        <AlertCircle className="w-4 h-4" />
      </div>
      <p className="leading-snug">
        <strong className="text-amber-400 font-semibold uppercase tracking-wider mr-1">
          Research prototype:
        </strong>
        A risk score here is a triage aid produced from a public parliamentary dataset. It is not a
        finding of irregularity or fraud, and nothing on this site is a determination by any
        office. No document, order, or filing is issued from here.
      </p>
    </div>
  );
}
