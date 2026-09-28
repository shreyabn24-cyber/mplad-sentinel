/**
 * Project Detail Page — e-SAKSHI / MPLADS
 * Based on: stitch_mplads_sentinel_ui_prototype/project_detail_satellite_verification_rampur
 */

import React from 'react';
import Link from 'next/link';
import {
  fetchWorkById,
  fetchSatelliteResult,
  fetchCitizenReportsForWork,
  generateAuditNote,
} from '@/lib/api';
import { getAnomalyCausesForWork } from '@/lib/anomalyReasons';

function formatLakh(n?: number | null) {
  if (!n) return '₹—';
  return `₹${(n / 100_000).toFixed(2)}L`;
}

function daysBetween(from?: string, to?: string) {
  if (!from) return null;
  const start = new Date(from);
  const end = to ? new Date(to) : new Date();
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string; icon: string }> = {
    COMPLETED: { cls: 'bg-secondary-container text-on-secondary-container', label: 'Completed', icon: 'check_circle' },
    IN_PROGRESS: { cls: 'bg-primary-fixed text-on-primary-fixed', label: 'Ongoing', icon: 'construction' },
    SANCTIONED: { cls: 'bg-surface-container text-on-surface', label: 'Sanctioned', icon: 'approval' },
    RECOMMENDED: { cls: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', label: 'Recommended', icon: 'thumb_up' },
    CANCELLED: { cls: 'bg-error-container text-on-error-container', label: 'Cancelled', icon: 'cancel' },
  };
  const s = map[status || ''] || { cls: 'bg-surface-container text-on-surface', label: status || 'Unknown', icon: 'help' };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${s.cls}`}>
      <span className="material-symbols-outlined text-[14px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

export default async function WorkDetailPage({ params }: { params: { id: string } }) {
  const workId = params.id;

  // The satellite/citizen helpers resolve to explicit "unavailable" records
  // rather than rejecting, but fetchWorkById now rejects on any backend
  // failure, so a dead backend must not be rendered as a missing project.
  let work: Awaited<ReturnType<typeof fetchWorkById>>;
  let satelliteResult: Awaited<ReturnType<typeof fetchSatelliteResult>>;
  let citizenReports: Awaited<ReturnType<typeof fetchCitizenReportsForWork>>;
  try {
    [work, satelliteResult, citizenReports] = await Promise.all([
      fetchWorkById(workId),
      fetchSatelliteResult(workId),
      fetchCitizenReportsForWork(workId),
    ]);
  } catch {
    return (
      <div className="flex flex-col items-center justify-center py-space-3xl text-center px-gutter-desktop">
        <span className="material-symbols-outlined text-[64px] text-error mb-space-md">cloud_off</span>
        <h1 className="section-title mb-2">Project Data Unavailable</h1>
        <p className="text-on-surface-variant mb-space-lg max-w-md">
          The project record for <code>{workId}</code> could not be loaded because the backend
          service is not responding. No data has been substituted or cached from a previous
          request. Please retry once the service is available.
        </p>
        <Link href="/works" className="btn-primary">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Projects
        </Link>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="flex flex-col items-center justify-center py-space-3xl text-center px-gutter-desktop">
        <span className="material-symbols-outlined text-[64px] text-outline mb-space-md">search_off</span>
        <h1 className="section-title mb-2">Project Not Found</h1>
        <p className="text-on-surface-variant mb-space-lg">Work ID <code>{workId}</code> could not be found in the database.</p>
        <Link href="/works" className="btn-primary">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Projects
        </Link>
      </div>
    );
  }

  const daysElapsed = daysBetween(work.sanction_date);
  const utilPct = work.sanction_amount && work.expenditure_amount
    ? Math.min(100, (work.expenditure_amount / work.sanction_amount) * 100)
    : null;

  // On /works/{id} the backend returns the risk figure under a NESTED
  // RiskScoreResponse object, not as a bare number. The old code compared it
  // directly, which is always false for an object, and called .toFixed() on it,
  // which would throw. The real scalar is composite_score inside that object.


  const compositeScore: number | null = (() => {
    const rs: any = (work as any)?.risk_score;
    if (rs == null) return null;
    if (typeof rs === 'number') return rs;            // tolerate list-style shape
    return typeof rs.composite_score === 'number' ? rs.composite_score : null;
  })();
  const riskTier: string | null = (() => {
    const rs: any = (work as any)?.risk_score;
    return rs && typeof rs === 'object' ? (rs.confidence_tier ?? null) : (work.confidence_tier ?? null);
  })();

  // The backend returns a flat satellite result. `demo_result` was a field the
  // old mock response carried to wrap a fabricated verdict; there is no such
  // field in any real response, so reading it is a silent way to lose the
  // genuine result and fall through to "nothing recorded".
  const satData = satelliteResult;
  const hasSatData = satData?.change_score != null;

  /**
   * Satellite verdict, with three states rather than two.
   *
   * The old expression was `flag ? 'Physical Anomaly Detected' : 'Physical
   * Construction Verified'`. Because `satellite_flag` is `null` whenever no
   * verdict was reached — which is the case for every check the current
   * backend can actually perform — that ternary reported "Physical
   * Construction Verified" for checks that never ran. Absence of evidence was
   * being rendered as confirmation of construction, which is the single most
   * damaging possible misreport in this tool. An unmeasured check now says so.
   *
   * The two non-null branches are unreachable with the current backend, which
   * performs a scene search and returns null. They are kept so that the panel
   * stays correct if a real per-pixel stage is ever added, but their wording no
   * longer claims corroboration. The old fallback text read "Authentic
   * built-up spectral change corroborated with claimed completion" — an index
   * delta measured against a free-text dataset field corroborates nothing,
   * because the field is not ground truth to compare against.
   */
  const satVerdict = (() => {
    if (satData?.satellite_flag === true) {
      return {
        tone: 'warning',
        icon: 'warning',
        headline: 'Built-up change detected at reported coordinates',
        detail:
          satData.evidence_text ||
          'A built-up spectral index rose at these coordinates. Treat it as a reason to visit, not a finding.',
      };
    }
    if (satData?.satellite_flag === false) {
      return {
        tone: 'success',
        icon: 'check_circle',
        headline: 'No built-up change detected at reported coordinates',
        detail:
          satData.evidence_text ||
          'The built-up index did not move here. This does not establish that the work happened, was not done, or was done elsewhere.',
      };
    }
    return {
      tone: 'warning',
      icon: 'help',
      headline: 'No imagery finding for this work',
      detail:
        satData?.evidence_text ||
        'No imagery-based construction verdict has been reached for this work. A scene search ' +
          'records which Sentinel-2 imagery covers the site; it does not measure built-up change, ' +
          'so construction can be neither confirmed nor ruled out from satellite data here.',
    };
  })();

  return (
    <div className="flex flex-col w-full">
      {/* ── Sub-Header Status Bar ───────────────────────────────────── */}
      <section className="w-full bg-surface-container-lowest shadow-sm border-b border-outline-variant/30">
        <div className="max-w-container-max mx-auto px-gutter-desktop py-space-md">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-space-xs text-xs text-on-surface-variant mb-space-sm">
            <Link href="/" className="hover:text-primary transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">home</span>Home
            </Link>
            <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
            <Link href="/works" className="hover:text-primary transition-colors">Projects</Link>
            <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
            <span className="text-on-surface font-semibold truncate max-w-xs">
              {work.work_type?.replace(/_/g, ' ') || workId}
            </span>
          </nav>

          {/* Title row */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
            <div>
              <div className="flex flex-wrap items-center gap-space-sm mb-1">
                <h1
                  className="text-[28px] leading-[36px] font-bold text-on-surface tracking-tight"
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {work.work_type?.replace(/_/g, ' ') || 'MPLADS Work'}
                </h1>
                <StatusBadge status={work.status} />
                <span className="px-2 py-0.5 bg-surface-container font-label-sm text-label-sm text-on-surface-variant rounded text-xs">
                  Ref: #{work.work_id}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-space-md gap-y-1 text-xs text-on-surface-variant">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">pin_drop</span>
                  District: <strong className="text-on-surface ml-0.5">{work.district_code}, {work.state_code}</strong>
                </span>
                {work.constituency_code && (
                  <>
                    <span>•</span>
                    <span>Constituency: <strong className="text-on-surface">{work.constituency_code}</strong></span>
                  </>
                )}
                <span>•</span>
                <span>
                  Hon&apos;ble MP:{' '}
                  <span className="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-medium">
                    {work.mp_name || 'Masked (Public Citizen View)'}
                  </span>
                </span>
              </div>
            </div>

            {/* Action ribbon */}
            <div className="flex flex-wrap items-center gap-space-sm shrink-0">
              <Link
                href={`/citizen?work_id=${workId}`}
                className="btn-primary text-sm"
              >
                <span className="material-symbols-outlined text-[18px] text-secondary-fixed">add_a_photo</span>
                Report What You See
              </Link>
              <Link
                href="/citizen"
                className="inline-flex items-center gap-1.5 px-space-md py-2.5 bg-surface-container-lowest text-error rounded-lg font-label-md text-label-md hover:bg-error-container transition-all shadow-sm text-sm"
              >
                <span className="material-symbols-outlined text-[18px]">flag</span>
                Raise a Concern
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Main Data Body ──────────────────────────────────────────── */}
      <div className="max-w-container-max mx-auto px-gutter-desktop py-space-xl w-full flex flex-col gap-space-2xl">

        {/* ── KPI Bento Strip ────────────────────────────────────────── */}
        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
            {/* KPI 1: Fiscal Utilization */}
            <div className="stitch-card p-space-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-xs mb-1">
                  <span>FISCAL UTILIZATION</span>
                  <span className="material-symbols-outlined text-secondary text-[20px]">account_balance_wallet</span>
                </div>
                <div className="text-[28px] font-bold text-on-surface mb-0.5" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {formatLakh(work.sanction_amount)}
                </div>
                <p className="text-xs text-on-surface-variant">Sanctioned amount on record</p>
              </div>
              {utilPct != null && (
                <div className="mt-space-md">
                  <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden flex mb-2">
                    <div className="bg-secondary h-full" style={{ width: `${utilPct}%` }} title={`Utilised: ${formatLakh(work.expenditure_amount)}`} />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div>
                      <div className="text-outline">Spent</div>
                      <div className="font-bold text-secondary">{formatLakh(work.expenditure_amount)}</div>
                    </div>
                    <div>
                      <div className="text-outline">Balance</div>
                      <div className="font-bold text-on-surface">{formatLakh((work.sanction_amount || 0) - (work.expenditure_amount || 0))}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* KPI 2: Project Schedule */}
            <div className="stitch-card p-space-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-xs mb-1">
                  <span>PROJECT SCHEDULE</span>
                  <span className="material-symbols-outlined text-primary-container text-[20px]">calendar_clock</span>
                </div>
                <div className="text-[28px] font-bold text-on-surface mb-0.5" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                  {daysElapsed != null ? `${daysElapsed}d` : '—'}
                </div>
                <p className="text-xs text-on-surface-variant">
                  Since:{' '}
                  {work.sanction_date
                    ? new Date(work.sanction_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
                    : 'N/A'}
                </p>
              </div>
              {work.completion_date && (
                <div className="mt-space-md text-xs">
                  <div className="flex justify-between text-outline mt-2">
                    <span>Sanction: {new Date(work.sanction_date || '').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>
                    <span>Target: {new Date(work.completion_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>
                  </div>
                </div>
              )}
            </div>

            {/* KPI 3: Risk Score */}
            <div className="stitch-card p-space-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-xs mb-1">
                  <span>AI RISK SCORE</span>
                  <span className="material-symbols-outlined text-on-tertiary-container text-[20px]">analytics</span>
                </div>
                <div
                  className={`text-[28px] font-bold mb-0.5 ${
                    (compositeScore ?? 0) >= 70
                      ? 'text-error'
                      : (compositeScore ?? 0) >= 40
                      ? 'text-on-tertiary-container'
                      : 'text-secondary'
                  }`}
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {compositeScore != null ? compositeScore.toFixed(0) : '—'}<span className="text-base font-normal text-on-surface-variant">/100</span>
                </div>
                <p className="text-xs text-on-surface-variant">
                  {work.confidence_tier ? `Tier ${work.confidence_tier} Classification` : 'Not yet scored'}
                </p>
              </div>
              {compositeScore != null && (
                <div className="mt-space-md">
                  <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        (compositeScore ?? 0) >= 70 ? 'bg-error' : (compositeScore ?? 0) >= 40 ? 'bg-on-tertiary-container' : 'bg-secondary'
                      }`}
                      style={{ width: `${compositeScore}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-outline mt-1">
                    <span>Low Risk</span>
                    <span>Critical</span>
                  </div>
                </div>
              )}
            </div>

            {/*
              KPI 4. It was headed "CROSS-VERIFICATION STATUS" and read "Verified
              OK" when `satellite_flag` was false. Nothing cross-verifies
              anything: there is a score and a stored field, and the other
              source is a text field from the same scraped row. "Verified OK"
              also reads as a cleared work, which a scene search cannot produce.

              The "not measured" branch is the only one the current backend can
              reach, and that is now the wording for all three states.
            */}
            <div className="rounded-xl p-space-md flex flex-col justify-between shadow-sm bg-secondary-container">
              <div>
                <div className="flex items-center justify-between font-label-sm text-xs mb-1 text-on-secondary-container">
                  <span>IMAGERY CHECK</span>
                  <span className="material-symbols-outlined text-[20px]">help</span>
                </div>
                <div
                  className="text-[20px] font-bold mb-0.5"
                  style={{ fontFamily: "'Public Sans', sans-serif" }}
                >
                  {satData?.satellite_flag == null
                    ? 'Not measured'
                    : satData.satellite_flag
                      ? 'Change seen'
                      : 'No change seen'}
                </div>
                <p className="text-xs opacity-80">
                  {satData?.satellite_flag == null
                    ? 'No imagery-based finding for this work'
                    : 'A built-up index moved or did not move here. Neither is a finding about the work.'}
                </p>
              </div>
              <div className="mt-space-md text-xs opacity-80 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">satellite_alt</span>
                Sentinel-2 scene search
              </div>
            </div>
          </div>
        </section>

        {/* ── Two Column Layout: Detail + Satellite ────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-xl">
          {/* Left column — Project details */}
          <div className="lg:col-span-2 flex flex-col gap-space-xl">

            {/* Project Information */}
            <div className="stitch-card p-space-lg">
              <h2 className="section-title mb-space-md flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary-container">info</span>
                Project Information
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md text-sm">
                <div>
                  <div className="stitch-label">Work ID</div>
                  <div className="font-mono text-on-surface">{work.work_id}</div>
                </div>
                <div>
                  <div className="stitch-label">Work Type</div>
                  <div className="text-on-surface">{work.work_type?.replace(/_/g, ' ') || '—'}</div>
                </div>
                <div>
                  <div className="stitch-label">District</div>
                  <div className="text-on-surface">{work.district_code || '—'}</div>
                </div>
                <div>
                  <div className="stitch-label">State</div>
                  <div className="text-on-surface">{work.state_code || '—'}</div>
                </div>
                <div>
                  <div className="stitch-label">Sanction Date</div>
                  <div className="text-on-surface">
                    {work.sanction_date
                      ? new Date(work.sanction_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="stitch-label">Target Completion</div>
                  <div className="text-on-surface">
                    {work.completion_date
                      ? new Date(work.completion_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="stitch-label">Status</div>
                  <StatusBadge status={work.status} />
                </div>
                <div>
                  <div className="stitch-label">Confidence Tier</div>
                  <div>
                    {work.confidence_tier
                      ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                          work.confidence_tier === 'L3'
                            ? 'bg-error-container text-on-error-container'
                            : work.confidence_tier === 'L2'
                            ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                            : 'bg-surface-container text-on-surface-variant'
                        }`}>
                          {work.confidence_tier === 'L3' && <span className="material-symbols-outlined text-[12px]">warning</span>}
                          {work.confidence_tier}
                        </span>
                      )
                      : <span className="text-on-surface-variant">Not scored</span>
                    }
                  </div>
                </div>
              </div>
            </div>

            {/* AI Anomaly Causes & Forensic Root Analysis */}
            {((compositeScore ?? 0) >= 40 || riskTier === 'L2' || riskTier === 'L3') && (() => {
              const causes = getAnomalyCausesForWork(
                work.active_signals || ['satellite_score', 'weather_score', 'isolation_score'],
                work.work_type
              );
              return (
                <div className="stitch-card p-space-lg border-l-4 border-error space-y-space-md">
                  <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-error text-[24px]">crisis_alert</span>
                      <div>
                        <h2 className="text-base font-bold text-on-surface" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                          Identified Causes for Project Anomaly Flag
                        </h2>
                        <p className="text-xs text-on-surface-variant">
                          Corroborative multi-signal forensic audit breakdown generated by e-SAKSHI ML Ensemble
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-error-container text-on-error-container font-mono">
                      {causes.length} Root Causes Flagged
                    </span>
                  </div>

                  <div className="space-y-3">
                    {causes.map((cause) => (
                      <div
                        key={cause.code}
                        className="p-3.5 rounded-xl border border-outline-variant/40 bg-surface-container-low space-y-2 hover:bg-surface-container transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                              <span className="material-symbols-outlined text-[17px]">{cause.icon}</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-on-surface">{cause.name}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-outline-variant/30 rounded text-on-surface-variant">
                                  {cause.code}
                                </span>
                              </div>
                              <span className="text-[10px] uppercase font-bold tracking-wider text-error">
                                {cause.severity} SEVERITY • {cause.category}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-on-surface-variant leading-relaxed">
                          {cause.summary}
                        </p>

                        <div className="pt-2 border-t border-outline-variant/20 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                          <div className="bg-surface-container-lowest p-2 rounded border border-outline-variant/30">
                            <span className="font-bold text-primary block mb-0.5">Forensic Telemetry:</span>
                            <span className="text-on-surface-variant">{cause.forensicEvidence}</span>
                          </div>
                          <div className="bg-surface-container-lowest p-2 rounded border border-outline-variant/30">
                            <span className="font-bold text-amber-900 block mb-0.5">Statutory Standard:</span>
                            <span className="text-on-surface-variant">{cause.regulatoryStandard}</span>
                          </div>
                        </div>

                        <div className="p-2 bg-error-container/20 rounded border border-error/20 flex items-center gap-2 text-[11px] text-error font-medium">
                          <span className="material-symbols-outlined text-[15px]">gavel</span>
                          <span>Mandatory Auditor Action: {cause.recommendedAuditAction}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Citizen Reports */}
            <div className="stitch-card p-space-lg">
              <div className="flex items-center justify-between mb-space-md">
                <h2 className="section-title flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-secondary">groups</span>
                  Citizen Ground-Truth Reports
                </h2>
                <Link href={`/citizen?work_id=${workId}`} className="btn-secondary text-xs">
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add Report
                </Link>
              </div>

              {citizenReports.length === 0 ? (
                <div className="text-center py-8 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[40px] text-outline block mb-2">photo_camera</span>
                  <p className="text-sm">
                    No citizen reports recorded in the audit registry for this work.
                  </p>
                  <Link href={`/citizen?work_id=${workId}`} className="btn-primary mt-space-md text-sm inline-flex">
                    <span className="material-symbols-outlined text-[16px]">add_a_photo</span>
                    Submit Report
                  </Link>
                </div>
              ) : (
                <div className="space-y-space-sm">
                  {citizenReports.map((report, i) => (
                    <div key={report.report_id || i} className="bg-surface-container rounded-lg p-space-md">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-on-primary-container text-[16px]">person</span>
                          </div>
                          <div>
                            {/*
                              Was `Citizen Reporter #{i + 1}`, which both
                              anonymised the submitter and invented a sequence
                              number. The response carries the account name for
                              auditor reads, so it is shown when present and
                              omitted — not renumbered — when it is not.
                            */}
                            <div className="text-xs font-semibold text-on-surface">
                              {report.reporter_username
                                ? `Citizen reporter: ${report.reporter_username}`
                                : 'Citizen reporter (not disclosed)'}
                            </div>
                            <div className="text-xs text-on-surface-variant">
                              {report.submitted_at
                                ? new Date(report.submitted_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
                                : 'Date unknown'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${report.work_complete ? 'bg-secondary-container text-on-secondary-container' : 'bg-tertiary-fixed text-on-tertiary-fixed-variant'}`}>
                            {report.work_complete ? 'Reports Complete' : 'Ongoing'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div className="text-center p-1 bg-surface-container-low rounded">
                          <span className="material-symbols-outlined text-[14px] block text-center mb-0.5">construction</span>
                          <div className="text-on-surface-variant">Visible</div>
                          <div className={`font-semibold ${report.construction_visible ? 'text-secondary' : 'text-error'}`}>
                            {report.construction_visible ? 'Yes' : 'No'}
                          </div>
                        </div>
                        <div className="text-center p-1 bg-surface-container-low rounded">
                          <span className="material-symbols-outlined text-[14px] block text-center mb-0.5">star_rate</span>
                          <div className="text-on-surface-variant">Quality</div>
                          <div className="font-semibold text-on-surface">{report.quality_rating}/5</div>
                        </div>
                        <div className="text-center p-1 bg-surface-container-low rounded">
                          <span className="material-symbols-outlined text-[14px] block text-center mb-0.5">location_on</span>
                          <div className="text-on-surface-variant">Distance</div>
                          <div className="font-semibold text-on-surface">
                            {report.distance_from_work_m != null ? `${report.distance_from_work_m}m` : '—'}
                          </div>
                        </div>
                      </div>

                      {report.comments && (
                        <p className="text-xs text-on-surface-variant mt-2 italic">
                          &ldquo;{report.comments}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column — Satellite + Evidence */}
          <div className="flex flex-col gap-space-xl">
            {/*
              Satellite scene lookup.

              This panel was a before/after image comparison with an "NDBI Delta"
              and a "Change Score" tile, headed "Satellite Verification", under
              a promise that "AWS Sentinel-2 L2A pass will be analyzed
              automatically".

              None of that was ever true. The backend performs a STAC *search*:
              it records which Sentinel-2 scene covers a location, and returns
              `ndbi_change`, `change_score`, `satellite_flag` and both
              thumbnail URLs as null every time (see backend/routers/satellite.py
              and ml/models/satellite_detector.py). So the tiles rendered "N/A",
              the two image slots rendered an empty placeholder captioned with a
              hard-coded "S2A" and "S2B", and the whole arrangement read as a
              completed spectral comparison that had found nothing. The "NDBI
              Delta" tile was worse than empty: with a null value the ternary
              fell to the `text-error` branch, colouring an unmeasured quantity
              as though it were a failed measurement.

              It also promised automation that does not exist. Nothing schedules
              a scene search, so "pending" was a state the system could never
              reach.

              What is replaced with is a record of the search that was actually
              performed — which scene, when, how much cloud, from where — and a
              plain statement that no image analysis was done.
            */}
            <div className="stitch-card p-space-lg">
              <div className="flex items-center justify-between mb-space-md">
                <h2 className="section-title flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-primary-container">satellite_alt</span>
                  Satellite scene lookup
                </h2>
                <span className="px-2 py-0.5 bg-secondary-container/60 text-on-secondary-container text-[11px] font-semibold rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">cloud</span>
                  AWS Open Data
                </span>
              </div>

              {satVerdict ? (
                <div>
                  <div className={`notice-${satVerdict.tone} mb-space-md`}>
                    <span className="material-symbols-outlined text-[18px]">{satVerdict.icon}</span>
                    <div>
                      <div className="font-semibold text-sm">{satVerdict.headline}</div>
                      <div className="text-xs mt-0.5 opacity-90">{satVerdict.detail}</div>
                    </div>
                  </div>

                  {/*
                    Only the fields a STAC search can return. No index deltas:
                    there is no per-pixel analysis, so an NDBI or NDVI number here
                    could only ever have been invented.
                  */}
                  <div className="grid grid-cols-2 gap-2 mb-space-md text-xs">
                    <div className="bg-surface-container-low p-2 rounded">
                      <div className="text-outline text-[10px] uppercase font-semibold">Scene recorded</div>
                      <div className="font-bold text-sm text-on-surface truncate" title={satData?.scene_id_recorded || ''}>
                        {satData?.scene_id_recorded ? satData.scene_id_recorded.split('_')[0] : 'None on record'}
                      </div>
                    </div>
                    <div className="bg-surface-container-low p-2 rounded">
                      <div className="text-outline text-[10px] uppercase font-semibold">Search run on</div>
                      <div className="font-bold text-sm text-on-surface">
                        {satData?.check_date
                          ? new Date(satData.check_date).toLocaleDateString('en-IN', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'Not recorded'}
                      </div>
                    </div>
                    <div className="bg-surface-container-low p-2 rounded">
                      <div className="text-outline text-[10px] uppercase font-semibold">Cloud cover of scene</div>
                      <div className="font-bold text-sm text-on-surface">
                        {satData?.cloud_coverage_pct != null
                          ? `${satData.cloud_coverage_pct.toFixed(1)}%`
                          : 'Not reported'}
                      </div>
                    </div>
                    <div className="bg-surface-container-low p-2 rounded">
                      <div className="text-outline text-[10px] uppercase font-semibold">Image analysis</div>
                      <div className="font-bold text-sm text-on-surface">Not performed</div>
                    </div>
                  </div>

                  <div className="p-2.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-xs flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-on-surface-variant">
                      <span className="material-symbols-outlined text-[15px] text-primary">public</span>
                      <span>
                        Source:{' '}
                        <strong className="text-on-surface">
                          {satData?.data_source || 'AWS Sentinel-2 L2A, scene metadata only'}
                        </strong>
                      </span>
                    </div>
                    <span className="text-[10px] text-outline">Free STAC API</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[48px] text-outline block mb-2">satellite_alt</span>
                  <p className="text-sm font-semibold">No scene search has been run for this work.</p>
                  <p className="text-xs mt-1">
                    Nothing runs automatically. A scene search is an operator action against this
                    work&apos;s own coordinates.
                  </p>
                </div>
              )}
            </div>

            {/*
              This was headed "Legal Notice" and read "MP names are masked in
              public view to uphold impartial administrative process under
              MPLADS Guidelines 2016. Full details are accessible to designated
              audit authorities only."

              No such legal basis was established, no rule was cited that
              requires masking, and there are no "designated audit authorities"
              defined anywhere in this project — the roles are a database enum
              the research prototype created for itself. The visible part of it
              is true and is kept: MP identities are masked outside an audit
              session. The invented legal reasoning around it is not.
            */}
            <div className="notice-info">
              <span className="material-symbols-outlined text-[18px] text-primary-container shrink-0">gavel</span>
              <div>
                <div className="font-semibold text-xs text-on-surface mb-1">On masking and access</div>
                <p className="text-xs">
                  MP identities are masked for anonymous and non-audit views. This is a privacy
                  choice made by this prototype, not a legal requirement, and it is not tied to any
                  statutory guideline. Signed-in auditors and administrators see the unmasked record.
                </p>
              </div>
            </div>

            {/*
              "Authority Portal", "Risk Flag Active", "full evidence chain" and
              "Open Evidence Dossier" all pointed at this project's own /anomalies
              page, which is a list of rows that matched a review rule. There is
              no evidence chain, no dossier, and no authority portal. The link
              target was already correct, so only the framing needed to change.
            */}
            {(riskTier === 'L2' || riskTier === 'L3') && (
              <div className="bg-error-container rounded-xl p-space-md">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-error text-[20px]">warning</span>
                  <span className="font-semibold text-on-error-container text-sm">In the higher score bands</span>
                </div>
                <p className="text-xs text-on-error-container mb-space-md">
                  This work is in the {work.confidence_tier} band, meaning its stored fields matched
                  more review rules than most works in the dataset. That is a prompt to look, not a
                  finding. The rule matches are listed on the flagged works page.
                </p>
                <Link
                  href="/anomalies"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-on-error-container hover:underline"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  See the matched rules
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
